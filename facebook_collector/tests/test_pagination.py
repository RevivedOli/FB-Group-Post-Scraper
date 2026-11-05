from datetime import datetime,timezone,timedelta
from pathlib import Path
import json
import tempfile
import unittest
from unittest.mock import patch, MagicMock
from urllib.parse import urlencode

from ..accounts.manager import Accounts
from ..app import App
from ..collectors.facebook_gql import FacebookGQL,SafeContext
from ..collectors.pagination import contract_from_request,contract_path,load_contract,FEED_NAME,FEED_OPERATION
from ..errors import CollectorError
from ..groups.manager import Groups
from ..storage.database import Database,atomic_json
from .test_accounts import state,response
from .test_storage import bootstrap_html


def contract(gid='123'):
    body = urlencode({'doc_id':'987000','fb_api_req_friendly_name':FEED_NAME,
                      'fb_dtsg':'never-persist-this-secret',
                      'variables':json.dumps({'id':gid,'cursor':'old-browser-cursor','count':10,
                                              'sortingSetting':'CHRONOLOGICAL','__relay_internal__pv__test':True})})
    return contract_from_request('https://www.facebook.com/api/graphql/',body,'',gid)


def feed(pid='900',more=False,cursor=None):
    document=json.loads((Path(__file__).with_name('fixtures')/'group_feed.json').read_text())
    node=document['data']['node']
    post=node['group_feed']['edges'][0]['node']
    post['post_id']=pid
    post['comet_sections']['content']['story']['wwwURL']='https://www.facebook.com/groups/123/posts/'+pid
    node['group_feed']['page_info']={'has_next_page':more,'end_cursor':cursor}
    return response(json.dumps(document),content_type='application/json')


class PaginationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.db=Database(self.temp.name)
        self.aid=Accounts(self.db).add('Offline pagination')['id']
        Accounts(self.db).save(self.aid,state())
        Groups(self.db).add('123',account=self.aid,basis='Synthetic tests')
        record={**contract(),'account_id':self.aid}
        atomic_json(contract_path(self.db,self.aid,'123'),record)

    def tearDown(self):
        self.db.close(); self.temp.cleanup()

    def test_new_group_automatically_reuses_query_but_never_source_identity_or_cursor(self):
        Groups(self.db).add('456',account=self.aid,basis='Synthetic new source')
        def page(pid,more,cursor):
            return response(feed(pid,more,cursor).text.replace('123','456'))
        with patch.object(SafeContext,'get',return_value=response(bootstrap_html().replace('123','456'))), patch.object(SafeContext,'post',side_effect=[page('900',True,'next'),page('901',False,None)]) as send, patch('facebook_collector.collectors.facebook_gql.time.sleep'), patch.object(SafeContext,'_resolve_doc_id') as discover:
            result=App(self.db,FacebookGQL).scan('456',max_pages=2)
        self.assertEqual(result['pages'],2)
        discover.assert_not_called()
        variables=send.call_args_list[0].args[2]
        self.assertEqual(variables['id'],'456')
        self.assertEqual(variables['youthIntegrityHostID'],'456')
        self.assertIsNone(variables['cursor'])
        self.assertEqual(send.call_args_list[1].args[2]['cursor'],'next')
        self.assertEqual(load_contract(self.db,self.aid,'456')['source'],'automatic')

    def test_fresh_login_discovers_without_a_browser_or_manual_capture(self):
        contract_path(self.db,self.aid,'123').unlink()
        with patch.object(SafeContext,'get',return_value=response(bootstrap_html())), patch.object(SafeContext,'_resolve_doc_id',return_value='555') as discover, patch.object(SafeContext,'post',return_value=feed('900',False,None)) as send:
            result=App(self.db,FacebookGQL).scan('123')
        discover.assert_called_once_with(FEED_OPERATION,'https://www.facebook.com/groups/123')
        self.assertEqual(result['new_posts'],1)
        self.assertEqual(send.call_args.args[2]['id'],'123')
        self.assertEqual(load_contract(self.db,self.aid,'123')['doc_id'],'555')

    def test_discovery_failure_is_explicit_instead_of_first_page_only_success(self):
        contract_path(self.db,self.aid,'123').unlink()
        with patch.object(SafeContext,'get',return_value=response(bootstrap_html())), patch.object(SafeContext,'_resolve_doc_id',side_effect=LookupError('not found')), patch.object(SafeContext,'post') as send:
            with self.assertRaises(CollectorError) as caught:
                App(self.db,FacebookGQL).scan('123')
        self.assertEqual(caught.exception.code,'pagination_discovery_failed')
        send.assert_not_called()

    def test_expired_definition_is_rediscovered_automatically(self):
        record=load_contract(self.db,self.aid,'123')
        record['captured_at']=(datetime.now(timezone.utc)-timedelta(days=2)).isoformat()
        atomic_json(contract_path(self.db,self.aid,'123'),record)
        with patch.object(SafeContext,'get',return_value=response(bootstrap_html())), patch.object(SafeContext,'_resolve_doc_id',return_value='888') as discover, patch.object(SafeContext,'post',return_value=feed('900',False,None)):
            App(self.db,FacebookGQL).scan('123')
        discover.assert_called_once()
        self.assertEqual(load_contract(self.db,self.aid,'123')['doc_id'],'888')

    def test_other_accounts_query_is_never_used(self):
        other=Accounts(self.db).add('Another researcher')['id']
        Accounts(self.db).save(other,state())
        Groups(self.db).authorise('123',other,'Synthetic shared researcher test')
        with patch.object(SafeContext,'get',return_value=response(bootstrap_html())), patch.object(SafeContext,'_resolve_doc_id',return_value='777') as discover, patch.object(SafeContext,'post',return_value=feed('900',False,None)):
            result=App(self.db,FacebookGQL).scan('123',other)
        self.assertEqual(result['account_id'],other)
        discover.assert_called_once()
        self.assertEqual(load_contract(self.db,other,'123')['doc_id'],'777')

    def test_manual_capture_retains_request_from_initial_load(self):
        from ..collectors.pagination import capture
        playwright = MagicMock()
        context = playwright.chromium.launch_persistent_context.return_value
        page = MagicMock()
        context.pages = [page]
        context.storage_state.return_value = state()
        request = MagicMock(method='POST', url='https://www.facebook.com/api/graphql/')
        request.headers = {}
        request.post_data = urlencode({'doc_id':'987000', 'fb_api_req_friendly_name':FEED_NAME,
                                      'variables':json.dumps({'id':'123','cursor':None,'sortingSetting':'CHRONOLOGICAL'})})
        callbacks = {}
        context.on.side_effect = lambda event, callback: callbacks.update({event:callback})
        page.goto.side_effect = lambda *a, **kw: callbacks['request'](request)
        with patch('playwright.sync_api.sync_playwright') as start, patch('builtins.input',return_value='') as prompt, patch('facebook_collector.collectors.pagination.browser_login_evidence',return_value={'verified':True,'page_state':'authenticated'}):
            start.return_value.__enter__.return_value = playwright
            result = capture(self.db, '123', self.aid)
        self.assertEqual(result['sorting'], 'CHRONOLOGICAL')
        prompt.assert_called_once()
        page.wait_for_timeout.assert_any_call(2000)
        context.close.assert_called_once()

    def test_sorting_reuses_matching_contract_without_browser(self):
        from ..collectors.pagination import ensure_sorting
        with patch('facebook_collector.collectors.pagination.capture') as browser:
            ensure_sorting(self.db, '123', self.aid, 'chronological')
        browser.assert_not_called()

    def test_sorting_captures_then_verifies_before_collecting(self):
        from ..collectors.pagination import ensure_sorting
        record = load_contract(self.db, self.aid, '123')
        record['variables']['sortingSetting'] = 'TOP_POSTS'
        atomic_json(contract_path(self.db, self.aid, '123'), record)
        with patch('facebook_collector.collectors.pagination.capture') as browser:
            with self.assertRaises(CollectorError) as caught:
                ensure_sorting(self.db, '123', self.aid, 'chronological')
        self.assertEqual(caught.exception.code, 'feed_sorting_unverified')
        browser.assert_called_once_with(self.db, '123', account=self.aid)

    def test_capture_contract_drops_auth_fields_and_old_cursor(self):
        record=contract()
        self.assertEqual(record['variables']['cursor'],None)
        self.assertNotIn('never-persist-this-secret',json.dumps(record))
        self.assertNotIn('fb_dtsg',record)
        self.assertEqual(record['operation'],FEED_OPERATION)

    def test_wrong_group_or_nonfeed_request_not_captured(self):
        body=urlencode({'doc_id':'123','variables':json.dumps({'id':'999','cursor':None})})
        self.assertIsNone(contract_from_request('https://www.facebook.com/api/graphql/',body,FEED_NAME,'123'))
        self.assertIsNone(contract_from_request('https://evil.example/api/graphql/',body,FEED_NAME,'999'))
        self.assertIsNone(contract_from_request('https://www.facebook.com/api/graphql/',body,'SomeMutation','999'))

    def test_two_pages_use_same_observed_query_and_returned_cursor(self):
        app=App(self.db,FacebookGQL)
        with patch.object(SafeContext,'get',return_value=response(bootstrap_html())),patch.object(SafeContext,'post',side_effect=[feed('900',True,'next-A'),feed('901',False)]) as send,patch('facebook_collector.collectors.facebook_gql.time.sleep') as wait:
            result=app.scan('123')
        self.assertEqual((result['pages'],result['new_posts']),(2,2))
        self.assertTrue(result['coverage_complete'])
        self.assertIsNone(send.call_args_list[0].args[2]['cursor'])
        self.assertEqual(send.call_args_list[1].args[2]['cursor'],'next-A')
        self.assertTrue(send.call_args_list[1].args[2]['__relay_internal__pv__test'])
        wait.assert_called_once_with(10)

    def test_page_cap_stops_before_next_request(self):
        with patch.object(SafeContext,'get',return_value=response(bootstrap_html())),patch.object(SafeContext,'post',return_value=feed('900',True,'next-A')) as send,patch('facebook_collector.collectors.facebook_gql.time.sleep') as wait:
            result=App(self.db,FacebookGQL).scan('123',max_pages=1)
        self.assertEqual(send.call_count,1)
        wait.assert_not_called()
        self.assertFalse(result['coverage_complete'])

    def test_cutoff_stops_without_another_page_request(self):
        with patch.object(SafeContext,'get',return_value=response(bootstrap_html())),patch.object(SafeContext,'post',return_value=feed('900',True,'next-A')) as send,patch('facebook_collector.app.now',return_value='2026-11-20T12:00:00.000000+00:00'):
            result=App(self.db,FacebookGQL).scan('123',max_age_hours=1,stop_at_cutoff=True)
        self.assertEqual(send.call_count,1)
        self.assertEqual(result['stop_reason'],'age_cutoff')

    def test_repeated_cursor_retains_first_page_and_no_checkpoint(self):
        with patch.object(SafeContext,'get',return_value=response(bootstrap_html())),patch.object(SafeContext,'post',side_effect=[feed('900',True,'same'),feed('901',True,'same')]),patch('facebook_collector.collectors.facebook_gql.time.sleep'):
            with self.assertRaises(CollectorError) as caught:
                App(self.db,FacebookGQL).scan('123')
        self.assertEqual(caught.exception.code,'pagination_error')
        self.assertEqual(len(self.db.rows('SELECT * FROM posts')),1)
        self.assertIsNone(self.db.one('SELECT coverage_end FROM checkpoints')['coverage_end'])

    def test_no_progress_with_different_cursor_is_stopped(self):
        with patch.object(SafeContext,'get',return_value=response(bootstrap_html())),patch.object(SafeContext,'post',side_effect=[feed('900',True,'first'),feed('900',True,'second')]),patch('facebook_collector.collectors.facebook_gql.time.sleep'):
            with self.assertRaises(CollectorError):
                App(self.db,FacebookGQL).scan('123')

    def test_stale_or_other_account_contract_is_not_reused(self):
        path=contract_path(self.db,self.aid,'123')
        record=json.loads(path.read_text())
        record['captured_at']=(datetime.now(timezone.utc)-timedelta(days=2)).isoformat()
        atomic_json(path,record)
        with self.assertRaises(CollectorError) as caught:
            load_contract(self.db,self.aid,'123')
        self.assertEqual(caught.exception.code,'pagination_contract_expired')
        record['account_id']='another-user'; atomic_json(path,record)
        with self.assertRaises(CollectorError):
            load_contract(self.db,self.aid,'123')

    def test_observed_doc_id_failure_does_not_trigger_discovery(self):
        context=SafeContext(state(),'123',delay=0)
        context.observed_feed_contract=True
        try:
            with patch.object(context.operation_discovery,'discover_operation') as discover:
                with self.assertRaises(CollectorError):
                    context._invalidate_doc_id(FEED_OPERATION,'https://www.facebook.com/groups/123')
                discover.assert_not_called()
        finally:
            context.session.close()
