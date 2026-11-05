import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from ..accounts.manager import Accounts
from ..app import App
from ..collectors.facebook_gql import FacebookGQL, SafeContext, Group
from ..errors import CollectorError
from ..export import Exporter
from ..groups.manager import Groups
from ..storage.database import Database
from .test_accounts import state, response
from .test_checkpoint import FakeCollector, post
from ..collectors.base import Page


def bootstrap_html():
    data = {'header':{'id':'123','name':'Synthetic group','privacy_info':{'title':{'text':'Public'}}},
            'descriptor': {'queryName':'CometGroupDiscussionRootSuccessQuery','queryID':'123000',
                           'variables':{'groupID':'123','regular_stories_count':0,
                                        'regular_stories_stream_initial_count':0,'shouldDeferMainFeed':True,
                                        'sortingSetting':'CHRONOLOGICAL','__relay_internal__pv__test':True}}}
    return '<script type="application/json">' + json.dumps(data) + '</script>'


class RootOnlyFacebookGQL(FacebookGQL):
    """Exercise the retained root-query parser independently of automatic routing."""
    def pages(self, group_id):
        page = self.bootstrap_page(group_id)
        page.continuation_supported = page.has_next is False
        yield page


class StorageAndSDKTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Database(self.temp.name)
        self.account = Accounts(self.db).add('Offline')['id']
        Accounts(self.db).save(self.account,state())
        Groups(self.db).add('https://www.facebook.com/groups/123',account=self.account,basis='Synthetic fixtures only')

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def test_real_sdk_query_parser_to_sqlite_twice_without_network(self):
        source = json.loads((Path(__file__).with_name('fixtures')/'group_feed.json').read_text())
        raw = json.dumps({'data':{'group':source['data']['node']}})
        app = App(self.db,RootOnlyFacebookGQL)
        with patch.object(SafeContext,'get',return_value=response(bootstrap_html())), patch.object(SafeContext,'post',return_value=response(raw,content_type='application/json')) as query:
            first = app.scan('123')
            second = app.scan('123')
        self.assertEqual(first['new_posts'],1)
        self.assertEqual(second['new_posts'],0)
        self.assertEqual(second['duplicates'],1)
        variables = query.call_args.args[2]
        self.assertEqual(variables['sortingSetting'],'CHRONOLOGICAL')
        self.assertFalse(variables['shouldDeferMainFeed'])
        self.assertTrue(variables['__relay_internal__pv__test'])
        self.assertEqual(self.db.conn.execute('PRAGMA integrity_check').fetchone()[0],'ok')

    def test_real_sdk_group_factory_metadata(self):
        hover = {'data':{'node':{'__typename':'Group','id':'123','comet_hovercard_renderer':{'group':{
            'id':'123','name':'Synthetic group','url':'https://www.facebook.com/groups/123',
            'privacy_info':{'title':{'text':'Public'}}}}}}}
        about = {'data':{'group':{'id':'123','about_feed_units':[]}}}
        adapter = FacebookGQL(self.db,self.account,'123')
        try:
            with patch.object(SafeContext,'post',side_effect=[response(json.dumps(hover)), response(json.dumps(about))]):
                group = Group.from_group_id(adapter.context,'123')
                info = {'name':group.name,'privacy':group.privacy}
            self.assertEqual(info['name'],'Synthetic group')
            self.assertEqual(info['privacy'],'Public')
        finally:
            adapter.close()

    def test_private_access_requires_recorded_basis(self):
        with self.assertRaises(CollectorError):
            Groups(self.db).add('456',visibility='private',account=self.account)
        Groups(self.db).add('456',visibility='private',account=self.account,basis='Authorised member and collection approval')
        self.assertEqual(Groups(self.db).select_account(Groups(self.db).get('456')),self.account)

    def test_duplicate_group_is_clear_error_without_rebinding_or_overwriting(self):
        before = Groups(self.db).get('123')
        other = Accounts(self.db).add('Another local account')['id']
        with self.assertRaises(CollectorError) as caught:
            Groups(self.db).add('https://www.facebook.com/groups/123',name='Changed',account=other,basis='Different')
        self.assertEqual(caught.exception.code,'group_exists')
        self.assertEqual(Groups(self.db).get('123'),before)
        self.assertIsNone(self.db.one('SELECT * FROM group_access WHERE group_id=? AND account_id=?',('123',other)))

    def test_export_failure_does_not_ack_and_no_overwrite(self):
        App(self.db,lambda *args:FakeCollector([Page([post()],False,None)])).scan('123')
        exporter = Exporter(self.db)
        target = Path(self.temp.name)/'export.jsonl'
        exporter.export_new_posts(target)
        with self.assertRaises(CollectorError):
            exporter.export_new_posts(target)
        self.assertEqual(len(exporter.get_unprocessed_posts()),1)
        record = json.loads(target.read_text())
        self.assertEqual(record['event_id'],'facebook:123:900')

    def test_transaction_rollback_on_checkpoint_write_failure(self):
        app = App(self.db,lambda *args:FakeCollector([Page([post()],False,None)]))
        app.scan('123')
        before = self.db.one('SELECT coverage_end FROM checkpoints')['coverage_end']
        self.db.execute("CREATE TRIGGER offline BEFORE UPDATE ON checkpoints BEGIN SELECT RAISE(ABORT,'synthetic database failure'); END")
        with self.assertRaises(sqlite3.Error):
            app.scan('123')
        self.assertEqual(self.db.one('SELECT coverage_end FROM checkpoints')['coverage_end'],before)

    def test_database_is_not_legacy_database(self):
        self.assertEqual(Path(self.temp.name,'collector.db').stat().st_mode & 0o777,0o600)
        self.assertTrue(self.db.conn.execute('PRAGMA foreign_keys').fetchone()[0])
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO group_access(group_id,account_id,access_basis) VALUES('missing',?,'test')",(self.account,))

    def test_scan_filter_column_migrates_existing_database_without_losing_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            connection = sqlite3.connect(Path(directory)/'collector.db')
            schema = Path('facebook_collector/storage/schema.sql').read_text().replace(', filter_details TEXT','')
            connection.executescript(schema)
            connection.execute("INSERT INTO accounts(id,label) VALUES('existing','Existing account')")
            connection.commit()
            connection.close()
            migrated = Database(directory)
            try:
                self.assertIn('filter_details',{row['name'] for row in migrated.rows('PRAGMA table_info(scan_runs)')})
                self.assertEqual(migrated.one('SELECT label FROM accounts')['label'],'Existing account')
            finally:
                migrated.close()

    def test_repeated_cursor_is_failure_not_coverage(self):
        document = json.loads((Path(__file__).with_name('fixtures')/'group_feed.json').read_text())
        document['data']['node']['group_feed']['page_info'] = {'has_next_page':True,'end_cursor':'same'}
        with patch.object(SafeContext,'post',return_value=response(json.dumps(document),content_type='application/json')):
            adapter = FacebookGQL(self.db,self.account,'123')
            iterator = adapter.legacy_pages('123')
            next(iterator)
            with self.assertRaises(CollectorError) as caught:
                next(iterator)
            adapter.close()
        self.assertEqual(caught.exception.code,'pagination_error')

    def test_metadata_does_not_require_hovercard_or_about_queries(self):
        adapter = FacebookGQL(self.db,self.account,'123')
        try:
            with patch.object(SafeContext,'get',return_value=response(bootstrap_html())),patch.object(SafeContext,'post') as query:
                info = adapter.get_group_info('123')
            self.assertEqual(info['name'],'Synthetic group')
            query.assert_not_called()
        finally:
            adapter.close()

    def test_header_only_feed_is_reported_separately_from_metadata(self):
        header = {'data':{'group':{'id':'123','group_feed':{'edges':[]}}}}
        with patch.object(SafeContext,'get',return_value=response(bootstrap_html())),patch.object(SafeContext,'post',return_value=response(json.dumps(header))):
            result = App(self.db,RootOnlyFacebookGQL).inspect('123')
        self.assertEqual(result['metadata_status'],'verified')
        self.assertEqual(result['feed_access'],'unverified')
        self.assertEqual(result['sample_posts'],0)
        self.assertEqual(result['feed_error']['code'],'feed_not_loaded')
        self.assertEqual(result['feed_error']['details']['post_node_count'],0)

    def test_identified_posts_without_pagination_remain_partial(self):
        source = json.loads((Path(__file__).with_name('fixtures')/'group_feed.json').read_text())['data']['node']
        source['group_feed'].pop('page_info')
        with patch.object(SafeContext,'get',return_value=response(bootstrap_html())),patch.object(SafeContext,'post',return_value=response(json.dumps({'data':{'group':source}}))):
            result = App(self.db,RootOnlyFacebookGQL).scan('123')
        self.assertEqual(result['new_posts'],1)
        self.assertFalse(result['coverage_complete'])
        self.assertEqual(result['stop_reason'],'pagination_unavailable')
        self.assertIsNone(self.db.one('SELECT coverage_end FROM checkpoints')['coverage_end'])

    def test_inspect_distinguishes_post_access_from_pagination(self):
        source = json.loads((Path(__file__).with_name('fixtures')/'group_feed.json').read_text())['data']['node']
        source['group_feed'].pop('page_info')
        with patch.object(SafeContext,'get',return_value=response(bootstrap_html())),patch.object(SafeContext,'post',return_value=response(json.dumps({'data':{'group':source}}))):
            result = App(self.db,RootOnlyFacebookGQL).inspect('123')
        self.assertEqual(result['feed_access'],'verified_posts')
        self.assertEqual(result['sample_posts'],1)
        self.assertEqual(result['pagination_status'],'unverified')

    def test_root_query_without_compatible_cursor_retains_partial_coverage(self):
        source = json.loads((Path(__file__).with_name('fixtures')/'group_feed.json').read_text())['data']['node']
        source['group_feed']['page_info'] = {'has_next_page':True,'end_cursor':'opaque'}
        with patch.object(SafeContext,'get',return_value=response(bootstrap_html())),patch.object(SafeContext,'post',return_value=response(json.dumps({'data':{'group':source}}))):
            result = App(self.db,RootOnlyFacebookGQL).scan('123')
        self.assertFalse(result['coverage_complete'])
        self.assertEqual(result['stop_reason'],'pagination_unavailable')
        self.assertEqual(result['new_posts'],1)

    def test_page_transaction_failure_does_not_count_rolled_back_records(self):
        self.db.execute("CREATE TRIGGER reject_post BEFORE INSERT ON posts WHEN NEW.post_id='901' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END")
        app = App(self.db,lambda *args:FakeCollector([Page([post(),post('901')],False,None)]))
        with self.assertRaises(CollectorError):
            app.scan('123')
        self.assertEqual(self.db.rows('SELECT * FROM posts'),[])
        run = self.db.one('SELECT * FROM scan_runs')
        self.assertEqual(run['new_posts'],0)
        self.assertEqual(run['posts_fetched'],0)

    def test_missing_permalink_legacy_export_deferred(self):
        incomplete = {**post(),'post_url':None}
        App(self.db,lambda *args:FakeCollector([Page([incomplete],False,None)])).scan('123')
        result = Exporter(self.db).export_new_posts(Path(self.temp.name)/'legacy.jsonl',legacy=True)
        self.assertEqual((result['records'],result['deferred']),(0,1))
