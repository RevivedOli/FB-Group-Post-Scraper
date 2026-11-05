from datetime import datetime, timezone
import tempfile
import unittest
from unittest.mock import patch

from ..app import App
from ..accounts.manager import Accounts
from ..collectors.base import Page
from ..errors import CollectorError
from ..export import Exporter
from ..groups.manager import Groups
from ..scheduler import tick
from ..storage.database import Database


def post(pid='900', published='2026-11-01T10:00:00.000000+00:00', text='Recommend an electrician?'):
    return {'group_id': '123','post_id': pid,'text':text,'published_at':published,
            'post_url': f'https://www.facebook.com/groups/123/posts/{pid}', 'collector':'facebook_gql'}


class FakeCollector:
    def __init__(self, pages, failure=None):
        self.data = pages
        self.failure = failure
        self.closed = False

    def pages(self, gid):
        yield from self.data
        if self.failure:
            raise self.failure

    def close(self):
        self.closed = True

    def get_group_info(self, gid):
        return {'group_id': gid,'name':'Synthetic group','url': 'https://www.facebook.com/groups/' + gid, 'privacy':'Public'}


class CheckpointTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Database(self.temp.name)
        self.account = Accounts(self.db).add('Test')['id']
        Groups(self.db).add('123', account=self.account, basis='Synthetic test only')

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def app(self, pages, failure=None):
        fake = FakeCollector(pages, failure)
        return App(self.db, lambda *args: fake)

    def checkpoint(self):
        return self.db.one('SELECT * FROM checkpoints WHERE group_id=?', ('123',))

    def test_repeat_scan_and_export_ack(self):
        app = self.app([Page([post()], False, None)])
        first = app.scan('123')
        second = app.scan('123')
        self.assertEqual((first['new_posts'], second['new_posts'], second['duplicates']), (1, 0, 1))
        self.assertEqual(second['new_records'], [])
        self.assertTrue(second['coverage_complete'])
        exporter = Exporter(self.db)
        self.assertEqual(len(exporter.get_unprocessed_posts()), 1)
        one = exporter.export_new_posts(self.temp.name + '/one.jsonl', legacy=True)
        two = exporter.export_new_posts(self.temp.name + '/two.jsonl', legacy=True)
        self.assertEqual(one['records'], two['records'])
        exporter.mark_post_exported('900', '123')
        exporter.mark_post_exported('900', '123')
        self.assertEqual(exporter.get_unprocessed_posts(), [])

    def test_cap_does_not_advance_successful_checkpoint(self):
        self.app([Page([post()], False, None)]).scan('123')
        before = self.checkpoint()['coverage_end']
        result = self.app([Page([post('901')], True, 'next')]).scan('123', max_pages=1)
        self.assertFalse(result['coverage_complete'])
        self.assertEqual(self.checkpoint()['coverage_end'], before)
        result = self.app([Page([post('902'), post('903')], False, None)]).scan('123', limit=1)
        self.assertFalse(result['coverage_complete'])
        self.assertEqual(self.checkpoint()['coverage_end'], before)

    def test_failure_keeps_posts_but_not_coverage(self):
        self.app([Page([post()], False, None)]).scan('123')
        before = self.checkpoint()['coverage_end']
        for code in ('parser_error', 'interrupted', 'authentication_required', 'restricted'):
            # Independent injected-failure scenarios, not retries of a blocked account.
            self.db.execute("UPDATE accounts SET status='authenticated'")
            self.db.execute("UPDATE group_access SET status='untested'")
            with self.assertRaises(CollectorError):
                self.app([Page([post('901')], True, 'next')], CollectorError(code, 'safe')).scan('123')
            self.assertEqual(self.checkpoint()['coverage_end'], before)
        self.assertEqual(len(self.db.rows('SELECT * FROM posts')), 2)
        self.assertEqual(self.db.one('SELECT status FROM accounts')['status'], 'restricted')

    def test_ranked_old_first_and_known_posts_do_not_stop(self):
        self.app([Page([post()], False, None)]).scan('123')
        result = self.app([Page([post()], True, 'next'),
                           Page([post('901','2026-11-04T11:00:00.000000+00:00')], False, None)]).scan('123')
        self.assertEqual(result['new_posts'], 1)
        self.assertEqual(result['pages'], 2)
        self.assertTrue(result['reached_overlap'])
        self.assertFalse(result['chronological_verified'])

    def test_missing_time_and_edits(self):
        self.app([Page([post()], False, None)]).scan('123')
        result = self.app([Page([post(published=None,text='Changed text')], False, None)]).scan('123')
        self.assertFalse(result['chronological_verified'])
        self.assertEqual(result['new_posts'], 0)
        row = self.db.one('SELECT * FROM posts')
        self.assertEqual(row['revision'], 2)
        self.assertIsNotNone(row['published_at'])

    def test_zero_is_not_success(self):
        with self.assertRaises(CollectorError):
            self.app([Page([], False, None)]).scan('123')
        self.assertIsNone(self.checkpoint()['coverage_end'])

    def test_age_filter_handles_old_first_and_inclusive_boundary(self):
        records = [post('900','2026-11-01T10:00:00+00:00'),
                   post('901','2026-11-04T06:00:00+00:00'),
                   post('902','2026-11-04T11:00:00+00:00'),post('903',published=None)]
        with patch('facebook_collector.app.now',return_value='2026-11-04T12:00:00.000000+00:00'):
            result = self.app([Page(records,False,None)]).scan('123',max_age_hours=6)
        self.assertEqual(result['new_posts'],2)
        self.assertEqual(result['skipped_old'],1)
        self.assertEqual(result['skipped_missing_timestamp'],1)
        self.assertEqual(result['cutoff_at'],'2026-11-04T06:00:00.000000+00:00')
        self.assertFalse(result['coverage_complete'])
        self.assertIsNone(self.checkpoint()['coverage_end'])

    def test_explicit_fast_stop_at_cutoff_keeps_partial_checkpoint(self):
        records = [post('900','2026-11-04T11:00:00+00:00'),post('901','2026-11-01T10:00:00+00:00'),post('902','2026-11-04T11:30:00+00:00')]
        with patch('facebook_collector.app.now',return_value='2026-11-04T12:00:00.000000+00:00'):
            result = self.app([Page(records,True,'next'),Page([post('903')],False,None)]).scan('123',max_age_hours=24,stop_at_cutoff=True)
        self.assertEqual(result['stop_reason'],'age_cutoff')
        self.assertEqual(result['posts_fetched'],2)
        self.assertEqual(result['new_posts'],1)
        self.assertEqual(result['pages'],1)
        self.assertFalse(result['coverage_complete'])
        self.assertIsNone(self.checkpoint()['coverage_end'])
        details = __import__('json').loads(self.db.one('SELECT filter_details FROM scan_runs')['filter_details'])
        self.assertEqual(details['max_age_hours'],24)
        self.assertTrue(details['stop_at_cutoff'])

    def test_age_scan_preserves_prior_global_coverage(self):
        self.app([Page([post()],False,None)]).scan('123')
        before = self.checkpoint()['coverage_end']
        with patch('facebook_collector.app.now',return_value='2026-11-04T12:00:00.000000+00:00'):
            result = self.app([Page([post()],False,None)]).scan('123',max_age_hours=1)
        self.assertEqual(result['skipped_old'],1)
        self.assertEqual(self.checkpoint()['coverage_end'],before)
        self.assertEqual(len(self.db.rows('SELECT * FROM posts')),1)

    def test_age_options_validate_before_collection(self):
        for value in (0,-1,float('nan'),float('inf'),1e300):
            with self.assertRaises(CollectorError) as caught:
                self.app([]).scan('123',max_age_hours=value)
            self.assertEqual(caught.exception.code,'invalid_options')
        with self.assertRaises(CollectorError):
            self.app([]).scan('123',stop_at_cutoff=True)

    def test_textless_posts_are_remembered_but_not_saved_or_emitted(self):
        records = [post('900',text=None),post('901',text=''),post('902',text=' \t\n\u2003'),post('903',text='Actual request 🎄')]
        app = self.app([Page(records,None,None,False)])
        first = app.scan('123')
        second = app.scan('123')
        self.assertEqual(first['skipped_no_text'],3)
        self.assertEqual(first['posts_fetched'],4)
        self.assertEqual(first['new_posts'],1)
        self.assertEqual((second['new_posts'],second['duplicates'],second['skipped_no_text']),(0,1,3))
        self.assertEqual(len(self.db.rows('SELECT * FROM posts')),1)
        self.assertEqual(len(self.db.rows('SELECT * FROM skipped_posts')),3)
        self.assertEqual(len(Exporter(self.db).get_unprocessed_posts()),1)
        self.assertFalse(second['coverage_complete'])

    def test_skipped_post_can_become_a_new_text_post_later(self):
        first = self.app([Page([post(text=None)],None,None,False)]).scan('123')
        self.assertEqual(first['new_posts'],0)
        result = self.app([Page([post(text='Now has text')],None,None,False)]).scan('123')
        self.assertEqual(result['new_posts'],1)
        self.assertEqual(result['new_records'][0]['text'],'Now has text')
        self.assertEqual(self.db.rows('SELECT * FROM skipped_posts'),[])

    def test_previous_text_is_not_erased_by_a_textless_response(self):
        self.app([Page([post()],None,None,False)]).scan('123')
        result = self.app([Page([post(text=None)],None,None,False)]).scan('123')
        self.assertEqual(result['skipped_no_text'],1)
        self.assertEqual(self.db.one('SELECT text FROM posts')['text'],'Recommend an electrician?')

    def test_legacy_textless_records_hidden_then_promoted_once(self):
        self.app([Page([post()],None,None,False)]).scan('123')
        self.db.execute('UPDATE posts SET text=NULL')  # Records created before the text-only change.
        self.assertEqual(Exporter(self.db).get_unprocessed_posts(),[])
        self.assertEqual(self.db.rows('SELECT post_id FROM posts WHERE has_text(text)'),[])
        result = self.app([Page([post(text='Text available now')],None,None,False)]).scan('123')
        self.assertEqual(result['new_posts'],1)
        result = self.app([Page([post(text='Text available now')],None,None,False)]).scan('123')
        self.assertEqual(result['new_posts'],0)

    def test_restart_recovers_stale_run(self):
        self.db.execute("INSERT INTO scan_runs(id,group_id,started_at) VALUES('dead','123','2026-01-01')")
        self.app([Page([post()], False, None)]).scan('123')
        self.assertEqual(self.db.one("SELECT status FROM scan_runs WHERE id='dead'")['status'], 'interrupted')

    def test_inspection_requires_posts(self):
        with self.assertRaises(CollectorError):
            self.app([Page([], False, None)]).inspect('123')
        result = self.app([Page([post()], False, None)]).inspect('123')
        self.assertEqual(result['feed_access'], 'verified_posts')

    def test_scheduler_gate_due_and_restriction(self):
        self.db.execute("UPDATE accounts SET status='authenticated'")
        app = self.app([Page([post()], False, None)])
        self.assertEqual(tick(self.db,app)[0]['skipped'], 'manual_scan_required')
        app.scan('123')
        self.assertEqual(tick(self.db,app), [])
        self.db.execute('UPDATE groups SET next_due_at=NULL')
        self.assertEqual(tick(self.db,app)[0]['new_posts'], 0)
        self.db.execute('UPDATE groups SET next_due_at=NULL')
        self.db.execute("UPDATE accounts SET status='restricted'")
        self.assertEqual(tick(self.db,app)[0]['skipped'], 'restricted')

    def test_cross_process_locks(self):
        with self.db.lock('group:123'):
            with self.assertRaises(CollectorError):
                with self.db.lock('group:123'):
                    pass


class KnownStreakTests(CheckpointTests):
    def test_stops_across_pages_without_advancing_complete_coverage(self):
        saved=[post(str(i)) for i in range(100,120)]
        self.app([Page(saved,False,None)]).scan('123',stop_after_known=0)
        before=self.checkpoint()['coverage_end']
        result=self.app([Page(saved[:6],True,'next'),Page(saved[6:12],True,'more'),Page([post('999')],False,None)]).scan('123')
        self.assertEqual((result['stop_reason'],result['posts_fetched'],result['pages']),('known_post_streak',10,2))
        self.assertFalse(result['coverage_complete'])
        self.assertEqual(self.checkpoint()['coverage_end'],before)

    def test_new_post_resets_nine_known_and_stops_at_next_ten(self):
        saved=[post(str(i)) for i in range(100,120)]
        self.app([Page(saved,False,None)]).scan('123',stop_after_known=0)
        records=saved[:9]+[post('999')]+saved[9:19]+[post('998')]
        result=self.app([Page(records,False,None)]).scan('123')
        self.assertEqual(result['new_posts'],1)
        self.assertEqual(result['posts_fetched'],20)
        self.assertEqual(result['consecutive_known'],10)
        self.assertEqual(result['stop_reason'],'known_post_streak')

    def test_repeated_same_post_does_not_advance_streak(self):
        self.app([Page([post()],False,None)]).scan('123')
        result=self.app([Page([post()]*15+[post('999')],False,None)]).scan('123')
        self.assertEqual(result['new_posts'],1)
        self.assertEqual(result['stop_reason'],'feed_end')

    def test_disable_and_invalid_threshold(self):
        for value in [-1,1.5,True]:
            with self.assertRaises(CollectorError):
                self.app([]).scan('123',stop_after_known=value)
        saved=[post(str(i)) for i in range(100,112)]
        self.app([Page(saved,False,None)]).scan('123',stop_after_known=0)
        result=self.app([Page(saved+[post('999')],False,None)]).scan('123',stop_after_known=0)
        self.assertEqual(result['new_posts'],1)
        self.assertEqual(result['stop_reason'],'feed_end')
