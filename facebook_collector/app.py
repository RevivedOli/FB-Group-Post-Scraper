"""Small synchronous orchestration layer; injectable collector for offline tests."""
from datetime import datetime, timedelta, timezone
import json
import math
import uuid

from .accounts.manager import Accounts
from .errors import CollectorError, fail
from .groups.manager import Groups
from .storage.database import now, has_text


class App:
    def __init__(self, db, collector_factory=None):
        self.db = db
        self.groups, self.accounts = Groups(db), Accounts(db)
        if collector_factory is None:
            from .collectors.facebook_gql import FacebookGQL
            collector_factory = FacebookGQL
        self.factory = collector_factory

    def inspect(self, gid, account=None):
        group = self.groups.get(gid)
        aid = self.groups.select_account(group, account)
        with self.db.lock('group:' + group['id']), self.db.lock('account:' + aid):
            collector = self.factory(self.db, aid, group['id'])
            try:
                info = collector.get_group_info(group['id'])
                info = {**info, 'account_id': aid, 'facebook_profile_id': self.accounts.get(aid)['profile_id']}
                # Metadata alone never proves feed access.
                try:
                    page = next(iter(collector.pages(group['id'])), None)
                except CollectorError as error:
                    if error.code not in ('parser_error', 'feed_operation_unavailable', 'access_unverified', 'feed_not_loaded'):
                        raise
                    self.db.execute('UPDATE groups SET access_status=? WHERE id=?', ('feed_unverified', group['id']))
                    problem = {'code': error.code, 'message': str(error)}
                    if error.details:
                        problem['details'] = error.details
                    return {**info, 'metadata_status': 'verified', 'feed_access': 'unverified',
                            'sample_posts': 0, 'feed_error': problem}
                if page is None or not page.posts:
                    fail('access_unverified', 'Group metadata loaded but actual post access could not be verified.')
                stamp = now()
                with self.db.conn:
                    self.db.conn.execute("UPDATE groups SET name=COALESCE(?,name),access_status='accessible' WHERE id=?",
                                         (info.get('name'), group['id']))
                    self.db.conn.execute("UPDATE group_access SET status='accessible',last_checked_at=? WHERE group_id=? AND account_id=?",
                                         (stamp, group['id'], aid))
                return {**info, 'feed_access': 'verified_posts', 'sample_posts': len(page.posts),
                        'pagination_status': ('unverified' if page.has_next is None else
                                              'end_of_feed' if page.has_next is False else
                                              'continuation_unavailable' if not page.continuation_supported else 'available')}
            except CollectorError as error:
                self.accounts.record_error(aid, error)
                self.db.execute('UPDATE groups SET access_status=? WHERE id=?', (error.code, group['id']))
                self.db.execute('UPDATE group_access SET status=?,last_checked_at=? WHERE group_id=? AND account_id=?',
                                (error.code, now(), group['id'], aid))
                raise
            finally:
                collector.close()

    def scan(self, gid, account=None, limit=100, max_pages=20, overlap_hours=24,
             max_age_hours=None, stop_at_cutoff=False):
        if limit < 1 or max_pages < 1 or overlap_hours < 0:
            fail('invalid_options', 'Limits must be positive; overlap cannot be negative.')
        if max_age_hours is not None and (not math.isfinite(max_age_hours) or max_age_hours <= 0):
            fail('invalid_options', 'Maximum age must be a finite positive number.')
        if stop_at_cutoff and max_age_hours is None:
            fail('invalid_options', '--stop-at-cutoff requires --max-age-hours or --max-age-days.')
        group = self.groups.get(gid)
        aid = self.groups.select_account(group, account)
        started, run = now(), uuid.uuid4().hex
        try:
            cutoff = datetime.fromisoformat(started) - timedelta(hours=max_age_hours) if max_age_hours is not None else None
        except OverflowError:
            fail('invalid_options', 'The requested age window is too large.')
        with self.db.lock('group:' + group['id']), self.db.lock('account:' + aid):
            # Only this group's stale run can be recovered, under its OS lock.
            with self.db.conn:
                self.db.conn.execute("UPDATE scan_runs SET status='interrupted',finished_at=?,error_code='interrupted',stop_reason='process_restart' WHERE group_id=? AND status='running'",
                                     (started, group['id']))
                self.db.conn.execute('INSERT INTO scan_runs(id,group_id,account_id,started_at) VALUES(?,?,?,?)',
                                     (run, group['id'], aid, started))
                self.db.conn.execute('UPDATE groups SET last_attempted_at=? WHERE id=?', (started, group['id']))
            checkpoint = self.db.one('SELECT * FROM checkpoints WHERE group_id=?', (group['id'],))
            lower = None
            if checkpoint and checkpoint['coverage_end']:
                lower = datetime.fromisoformat(checkpoint['coverage_end']) - timedelta(hours=overlap_hours)
            result = {'run_id': run, 'group_id': group['id'], 'account_id': aid,
                      'facebook_profile_id': self.accounts.get(aid)['profile_id'], 'posts_fetched': 0, 'new_posts': 0,
                      'duplicates': 0, 'pages': 0, 'scan_completed': False, 'coverage_complete': False,
                      'skipped_no_text': 0,
                      'skipped_old': 0, 'skipped_missing_timestamp': 0,
                      'cutoff_at': cutoff.isoformat(timespec='microseconds') if cutoff else None,
                      'max_age_hours': max_age_hours, 'stop_at_cutoff': stop_at_cutoff,
                      'reached_overlap': False, 'chronological_verified': False, 'stop_reason': None}
            collector, emitted, seen, times = None, [], {}, []
            missing_time, exhausted, truncated, unsupported_continuation = False, False, False, False
            cutoff_reached = False
            try:
                collector = self.factory(self.db, aid, group['id'])
                for page in collector.pages(group['id']):
                    result['pages'] += 1
                    if not page.posts and result['posts_fetched'] == 0:
                        fail('access_unverified', 'Zero posts cannot prove access or a healthy empty feed.')
                    remaining = limit - result['posts_fetched']
                    records = page.posts[:remaining]
                    truncated = len(records) < len(page.posts)
                    stamp = now()
                    page_new, page_duplicates, page_skipped = [], 0, 0
                    page_old, page_missing, processed_records = 0, 0, []
                    with self.db.conn:
                        for post in records:
                            # Adapter invariant: only stable identities for the assigned group.
                            if post.get('group_id') != group['id'] or not str(post.get('post_id', '')).isdigit():
                                fail('unstable_identity', 'Collector returned a missing or mismatched source identity.')
                            pid = post['post_id']
                            processed_records.append(post)
                            if cutoff is not None:
                                published_value = post.get('published_at')
                                if not published_value:
                                    page_missing += 1
                                    continue
                                try:
                                    published_time = datetime.fromisoformat(published_value)
                                    if published_time.tzinfo is None:
                                        raise ValueError()
                                except (ValueError, TypeError):
                                    fail('parser_error', 'Cannot apply age cutoff to an invalid publication timestamp.')
                                if published_time < cutoff:
                                    page_old += 1
                                    if stop_at_cutoff:
                                        cutoff_reached = True
                                        break
                                    continue
                            if not has_text(post.get('text')):
                                self.db.conn.execute('''INSERT INTO skipped_posts
                                  (group_id,post_id,reason,first_observed_at,last_observed_at,last_scan_id)
                                  VALUES(?,?,'no_text',?,?,?) ON CONFLICT(group_id,post_id) DO UPDATE SET
                                  last_observed_at=excluded.last_observed_at,last_scan_id=excluded.last_scan_id''',
                                  (group['id'], pid, stamp, stamp, run))
                                page_skipped += 1
                                continue
                            existing = self.db.one('SELECT text FROM posts WHERE group_id=? AND post_id=?', (group['id'], pid))
                            fresh = self.db.conn.execute('''INSERT OR IGNORE INTO posts
                              (group_id,post_id,post_url,text,published_at,first_observed_at,last_observed_at,collector,account_id,first_scan_id,last_scan_id)
                              VALUES(?,?,?,?,?,?,?,?,?,?,?)''',
                              (group['id'], pid, post.get('post_url'), post.get('text'), post.get('published_at'), stamp, stamp,
                               post['collector'], aid, run, run)).rowcount
                            if fresh or (existing is not None and not has_text(existing['text'])):
                                page_new.append({**post, 'account_id': aid, 'collected_at': stamp, 'is_new': True})
                            else:
                                page_duplicates += 1
                            if not fresh:
                                self.db.conn.execute('''UPDATE posts SET
                                  revision=revision+CASE WHEN ? IS NOT NULL AND text IS NOT ? THEN 1 ELSE 0 END,
                                  text=COALESCE(?,text),post_url=COALESCE(?,post_url),published_at=COALESCE(?,published_at),
                                  last_observed_at=?,last_scan_id=?,account_id=? WHERE group_id=? AND post_id=?''',
                                  (post.get('text'), post.get('text'), post.get('text'), post.get('post_url'), post.get('published_at'), stamp, run, aid, group['id'], pid))
                            self.db.conn.execute('DELETE FROM skipped_posts WHERE group_id=? AND post_id=?', (group['id'], pid))
                    # Advance counters/observations only after this page commits.
                    emitted.extend(page_new)
                    result['new_posts'] += len(page_new)
                    result['duplicates'] += page_duplicates
                    result['skipped_no_text'] += page_skipped
                    result['skipped_old'] += page_old
                    result['skipped_missing_timestamp'] += page_missing
                    result['posts_fetched'] += len(processed_records)
                    for post in processed_records:
                        pid = post['post_id']
                        if pid not in seen:
                            seen[pid] = None
                            if post.get('published_at'):
                                published = datetime.fromisoformat(post['published_at'])
                                times.append(published)
                                if lower and published <= lower:
                                    result['reached_overlap'] = True
                            else:
                                missing_time = True
                    self.db.execute('UPDATE scan_runs SET posts_fetched=?,new_posts=?,duplicates=?,pages=? WHERE id=?',
                                    (result['posts_fetched'], result['new_posts'], result['duplicates'], result['pages'], run))
                    if cutoff_reached:
                        break
                    if page.has_next is False and not truncated:
                        exhausted = True
                        break
                    if not page.continuation_supported:
                        unsupported_continuation = True
                        break
                    if result['posts_fetched'] >= limit or result['pages'] >= max_pages:
                        break
                if result['posts_fetched'] == 0:
                    fail('access_unverified', 'No actual posts were retrieved; access remains unverified.')
                # Verify only the observed sample, never infer global feed order.
                ordered_sample = len(times) >= 2 and not missing_time and all(a >= b for a, b in zip(times, times[1:]))
                result.update(scan_completed=True, coverage_complete=exhausted and cutoff is None,
                              chronological_verified=ordered_sample and getattr(collector, 'feed_sorting', None) == 'CHRONOLOGICAL',
                              observed_order_descending=ordered_sample,
                              feed_sorting=getattr(collector, 'feed_sorting', None),
                              stop_reason='age_cutoff' if cutoff_reached else ('feed_end' if exhausted else ('pagination_unavailable' if unsupported_continuation else 'scan_limit')))
                # Save legitimately updated cookies before marking coverage successful.
                collector.close()
                collector = None
                self._finish(group, aid, run, started, result, seen, times)
                return {**result, 'new_records': emitted}
            except BaseException as error:
                safe = error if isinstance(error, CollectorError) else CollectorError(
                    'interrupted' if isinstance(error, (KeyboardInterrupt, SystemExit)) else 'collector_error',
                    'Scan interrupted or failed; the successful coverage checkpoint is unchanged.')
                result.update(scan_completed=False, coverage_complete=False, stop_reason=safe.code)
                self._finish(group, aid, run, started, result, seen, times, safe)
                self.accounts.record_error(aid, safe)
                raise safe from None
            finally:
                if collector:
                    collector.close()

    def _finish(self, group, aid, run, started, result, seen, times, error=None):
        stamp = now()
        next_due = (datetime.fromisoformat(stamp) + timedelta(seconds=group['interval_seconds'])).isoformat(timespec='microseconds')
        latest = max(times).isoformat(timespec='microseconds') if times else None
        recent = list(seen)[-200:]
        last = recent[-1] if recent else None
        status = 'failed' if error else ('complete' if result['coverage_complete'] else 'partial')
        with self.db.conn:
            self.db.conn.execute('''UPDATE scan_runs SET finished_at=?,status=?,posts_fetched=?,new_posts=?,duplicates=?,pages=?,
              scan_completed=?,coverage_complete=?,chronological_verified=?,reached_overlap=?,stop_reason=?,error_code=?,error_message=?,filter_details=? WHERE id=?''',
              (stamp, status, result['posts_fetched'], result['new_posts'], result['duplicates'], result['pages'],
               result['scan_completed'], result['coverage_complete'], result['chronological_verified'], result['reached_overlap'],
               result['stop_reason'], error.code if error else None, str(error) if error else None,
               json.dumps({key: result[key] for key in ('max_age_hours','cutoff_at','stop_at_cutoff','skipped_no_text','skipped_old','skipped_missing_timestamp')}), run))
            self.db.conn.execute('''INSERT INTO checkpoints(group_id,latest_publication,last_post_id,recently_seen_ids,last_scan_completed,last_run_id)
              VALUES(?,?,?,?,?,?) ON CONFLICT(group_id) DO UPDATE SET
              latest_publication=CASE WHEN excluded.latest_publication > COALESCE(checkpoints.latest_publication,'')
                THEN excluded.latest_publication ELSE checkpoints.latest_publication END,
              last_post_id=COALESCE(excluded.last_post_id,checkpoints.last_post_id),recently_seen_ids=excluded.recently_seen_ids,
              last_scan_completed=excluded.last_scan_completed,last_run_id=excluded.last_run_id''',
              (group['id'], latest, last, json.dumps(recent), result['scan_completed'], run))
            if result['coverage_complete'] and not error:
                # Coverage is of the accessible feed at scan time, not deleted,
                # pending, or arbitrary future late-approved posts.
                self.db.conn.execute('UPDATE checkpoints SET coverage_end=?,last_successful_scan=?,chronological_verified=? WHERE group_id=?',
                                     (started, stamp, result['chronological_verified'], group['id']))
                self.db.conn.execute('UPDATE groups SET last_successful_at=? WHERE id=?', (stamp, group['id']))
            self.db.conn.execute('UPDATE groups SET next_due_at=?,last_observed_post=COALESCE(?,last_observed_post),access_status=? WHERE id=?',
                                 (next_due, last, error.code if error else 'accessible', group['id']))
            self.db.conn.execute('UPDATE group_access SET status=?,last_checked_at=? WHERE group_id=? AND account_id=?',
                                 (error.code if error else 'accessible', stamp, group['id'], aid))
