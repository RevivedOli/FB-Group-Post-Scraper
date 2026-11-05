"""Run as python -m facebook_collector.cli or python facebook_collector/cli.py."""
if __package__ in (None, ''):
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import argparse
import json
import math
import os
from pathlib import Path
import sqlite3
import sys
import tomllib
from functools import partial

from facebook_collector.accounts.manager import Accounts
from facebook_collector.app import App
from facebook_collector.errors import CollectorError, fail
from facebook_collector.export import Exporter
from facebook_collector.groups.manager import Groups
from facebook_collector.scheduler import serve
from facebook_collector.storage.database import Database


def emit(data):
    print(json.dumps(data, indent=2, ensure_ascii=False))


def parser():
    p = argparse.ArgumentParser(description='Independent local Facebook collector (no AI/messaging).')
    p.add_argument('--data-dir', default=os.environ.get('FACEBOOK_COLLECTOR_DATA_DIR', str(Path(__file__).parent / 'data')))
    p.add_argument('--config', type=Path, help='Optional TOML settings file; never store cookies here.')
    subs = p.add_subparsers(dest='area', required=True)
    subs.add_parser('init')
    a = subs.add_parser('account').add_subparsers(dest='action', required=True)
    add = a.add_parser('add'); add.add_argument('--label'); add.add_argument('--no-login', action='store_true')
    a.add_parser('list')
    a.add_parser('current')
    a.add_parser('clear-active')
    s = a.add_parser('use'); s.add_argument('account_id')
    for name in ('test', 'login', 'delete-session', 'remove'):
        s = a.add_parser(name); s.add_argument('account_id')
    g = subs.add_parser('group').add_subparsers(dest='action', required=True)
    s = g.add_parser('add'); s.add_argument('group'); s.add_argument('--name'); s.add_argument('--visibility', choices=['public','private','unknown'], default='unknown'); s.add_argument('--account'); s.add_argument('--access-basis')
    g.add_parser('list')
    s = g.add_parser('inspect'); s.add_argument('group'); s.add_argument('--account')
    s = g.add_parser('capture-pagination'); s.add_argument('group'); s.add_argument('--account'); s.add_argument('--auto',action='store_true',help='Load the group and scroll once; stop if a security check appears.')
    s = g.add_parser('authorise'); s.add_argument('group'); s.add_argument('--account', required=True); s.add_argument('--access-basis', required=True)
    s = g.add_parser('configure'); s.add_argument('group'); s.add_argument('--account'); s.add_argument('--enabled', choices=['yes','no']); s.add_argument('--interval-seconds', type=int)
    posts = subs.add_parser('posts').add_subparsers(dest='action', required=True)
    for command in ('fetch', 'sync', 'list'):
        s = posts.add_parser(command); s.add_argument('group'); s.add_argument('--limit', type=int, default=None)
        if command != 'list':
            s.add_argument('--sort', choices=['chronological','top'], help='Reuse this feed order, opening the browser to capture it when needed.')
            s.add_argument('--account'); s.add_argument('--max-pages', type=int); s.add_argument('--overlap-hours', type=float)
            s.add_argument('--request-delay-seconds',type=float,help='Minimum seconds between HTTP request starts (at least 2).')
            s.add_argument('--page-delay-seconds',type=float,help='Pause before each additional feed page (at least 2; default 10).')
            age = s.add_mutually_exclusive_group()
            age.add_argument('--max-age-hours', type=float, help='Keep only posts published within this many hours.')
            age.add_argument('--max-age-days', type=float, help='Keep only posts published within this many days.')
            s.add_argument('--stop-after-known', type=int, default=10, help='Stop after this many consecutive distinct saved, unchanged posts; 0 disables (default 10). Ranked feeds may hide older unseen posts.')
            s.add_argument('--stop-at-cutoff', action='store_true', help='Stop at the first old post; may miss newer posts in a ranked feed. Coverage stays partial.')
    scans = subs.add_parser('scans').add_subparsers(dest='action', required=True)
    scans.add_parser('list')
    export = subs.add_parser('export').add_subparsers(dest='action', required=True)
    s = export.add_parser('write'); s.add_argument('destination'); s.add_argument('--legacy', action='store_true')
    s = export.add_parser('ack'); s.add_argument('--group', required=True); s.add_argument('--post', required=True)
    s = subs.add_parser('schedule'); s.add_argument('--once', action='store_true')
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    db = None
    try:
        config = tomllib.loads(args.config.read_text()) if args.config else {}
        defaults = {'max_posts': 100, 'max_pages': 20, 'overlap_hours': 24,
                    'max_requests': 100, 'request_delay_seconds': 2, 'page_delay_seconds': 10, 'deadline_seconds': 600}
        if set(config) - set(defaults):
            fail('invalid_config', 'Unknown configuration key.')
        defaults.update(config)
        for option in ('request_delay_seconds','page_delay_seconds'):
            value = getattr(args,option,None)
            if value is not None:
                defaults[option] = value
            if not math.isfinite(defaults[option]) or defaults[option] < 2:
                fail('invalid_config','Request/page delays must be finite numbers of at least 2 seconds.')
        if (defaults['max_requests'] < 1 or defaults['max_requests'] > 500
                or defaults['request_delay_seconds'] < 2 or defaults['deadline_seconds'] <= 0):
            fail('invalid_config', 'Use 1–500 requests, delay >=2 seconds and a positive deadline.')
        db = Database(args.data_dir)
        accounts, groups = Accounts(db), Groups(db)
        if args.area == 'init':
            emit({'database': str(db.directory / 'collector.db'), 'status': 'ready'})
        elif args.area == 'account':
            if args.action == 'add':
                label = args.label or input('Account label: ').strip()
                account = accounts.add(label)
                emit(account)  # registration survives a cancelled/failed login
                if not args.no_login:
                    emit(accounts.login(account['id']))
            elif args.action == 'list':
                emit(db.rows('SELECT * FROM accounts ORDER BY label'))
            elif args.action == 'current':
                emit({'active_account': accounts.active()})
            elif args.action == 'use':
                emit(accounts.use(args.account_id))
            elif args.action == 'clear-active':
                accounts.clear_active(); emit({'active_account': None})
            elif args.action in ('test', 'login'):
                emit(getattr(accounts, args.action)(args.account_id))
            else:
                accounts.delete_session(args.account_id)
                if args.action == 'remove':
                    db.execute('DELETE FROM accounts WHERE id=?', (args.account_id,))
                emit({'status': args.action, 'account_id': args.account_id})
        elif args.area == 'group' and args.action != 'inspect':
            if args.action == 'list':
                emit(db.rows('SELECT * FROM groups ORDER BY id'))
            elif args.action == 'add':
                active = accounts.active()
                selected = args.account or (active['id'] if active else None)
                emit(groups.add(args.group, args.name, args.visibility, selected, args.access_basis))
            elif args.action == 'authorise':
                groups.authorise(args.group, args.account, args.access_basis); emit({'status': 'recorded'})
            elif args.action == 'capture-pagination':
                from facebook_collector.collectors.pagination import capture
                emit(capture(db,groups.get(args.group)['id'],args.account,args.auto))
            elif args.action == 'configure':
                group = groups.get(args.group)
                if args.account:
                    groups.select_account(group, args.account)
                    db.execute('UPDATE groups SET preferred_account=? WHERE id=?', (args.account, group['id']))
                if args.enabled:
                    db.execute('UPDATE groups SET enabled=? WHERE id=?', (args.enabled == 'yes', group['id']))
                if args.interval_seconds is not None:
                    if args.interval_seconds < 60:
                        fail('invalid_options', 'Use an interval of at least 60 seconds.')
                    db.execute('UPDATE groups SET interval_seconds=? WHERE id=?', (args.interval_seconds, group['id']))
                emit(groups.get(args.group))
        elif args.area == 'posts' and args.action == 'list':
            group = groups.get(args.group)
            limit = args.limit or 20
            if not 1 <= limit <= 10000:
                fail('invalid_options', 'Use a list limit from 1 to 10000.')
            emit(db.rows('SELECT * FROM posts WHERE group_id=? AND has_text(text) ORDER BY first_observed_at DESC,post_id DESC LIMIT ?', (group['id'], limit)))
        elif args.area == 'scans':
            runs = db.rows('SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 100')
            for run in runs:
                details = run.pop('filter_details', None)
                run.update(json.loads(details) if details else {'skipped_no_text': max(0,run['posts_fetched']-run['new_posts']-run['duplicates'])})
            emit(runs)
        elif args.area == 'export':
            exporter = Exporter(db)
            if args.action == 'write':
                emit(exporter.export_new_posts(args.destination, args.legacy))
            else:
                exporter.mark_post_exported(args.post, args.group); emit({'status': 'acknowledged'})
        else:
            from facebook_collector.collectors.facebook_gql import FacebookGQL
            factory = partial(FacebookGQL, max_requests=defaults['max_requests'],
                              delay=defaults['request_delay_seconds'], page_delay=defaults['page_delay_seconds'], deadline=defaults['deadline_seconds'])
            app = App(db, factory)
            options = {'limit': defaults['max_posts'], 'max_pages': defaults['max_pages'], 'overlap_hours': defaults['overlap_hours']}
            if args.area == 'group':
                inspection = app.inspect(args.group, args.account)
                emit(inspection)
                if inspection.get('feed_access') != 'verified_posts':
                    return 1
            elif args.area == 'schedule':
                serve(db, app, options, args.once, emit)
            else:
                for key, arg in [('limit', args.limit), ('max_pages', args.max_pages), ('overlap_hours', args.overlap_hours)]:
                    if arg is not None:
                        options[key] = arg
                if args.action == 'fetch' and args.limit is None:
                    options['limit'] = 20
                options['max_age_hours'] = args.max_age_hours if args.max_age_days is None else args.max_age_days * 24
                options['stop_at_cutoff'] = args.stop_at_cutoff
                options['stop_after_known'] = args.stop_after_known
                if args.sort:
                    from facebook_collector.collectors.pagination import ensure_sorting
                    ensure_sorting(db, args.group, args.account, args.sort)
                emit(app.scan(args.group, args.account, **options))
        return 0
    except CollectorError as error:
        result = {'error': error.code, 'message': str(error)}
        if error.details:
            result['details'] = dict(error.details)
            if args.area in ('group', 'posts') and getattr(args, 'group', None):
                result['details']['group'] = args.group
                if 'account_selection' not in result['details']:
                    active = accounts.active() if db else None
                    result['details']['account_selection'] = 'explicit_argument' if getattr(args, 'account', None) else ('active_account' if active else 'group_preferred_account')
        emit(result)
        return 1
    except KeyboardInterrupt:
        emit({'error': 'interrupted', 'message': 'Stopped by operator.'})
        return 130
    except (sqlite3.Error, OSError, ValueError, TypeError, EOFError):
        emit({'error': 'local_error', 'message': 'Local configuration, database, input or file operation failed. Check paths and settings.'})
        return 1
    except Exception:
        emit({'error': 'collector_error', 'message': 'Operation failed. No raw upstream details are printed because they may contain credentials. Check installation/browser availability and scans list.'})
        return 1
    finally:
        if db:
            db.close()


if __name__ == '__main__':
    sys.exit(main())
