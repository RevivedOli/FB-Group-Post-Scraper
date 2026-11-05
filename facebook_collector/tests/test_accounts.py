import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock
import requests

from ..accounts.manager import Accounts, load_jar, merged_state, browser_login_evidence
from ..collectors.facebook_gql import SafeContext, FacebookGQL
from ..errors import CollectorError
from ..storage.database import Database
from ..transport import GuardedSession, check_response


def state(uid='1234', token='synthetic-not-a-real-cookie'):
    return {'cookies': [
        {'name':'c_user','value':uid,'domain':'.facebook.com','path':'/','secure':True,'httpOnly':True,'sameSite':'Lax','expires':-1},
        {'name':'xs','value':token,'domain':'.facebook.com','path':'/','secure':True,'httpOnly':True,'sameSite':'Strict','expires':-1}],
        'origins':[]}


def response(text='ok', url='https://www.facebook.com/', status=200, content_type='text/html'):
    r = requests.Response()
    r.status_code = status
    r.url = url
    r.headers['content-type'] = content_type
    r.encoding = 'utf-8'
    r._content = text.encode()
    r._content_consumed = True
    return r


def browser_page(url='https://www.facebook.com/', authenticated=True):
    page = MagicMock()
    page.url = url
    page.is_closed.return_value = False
    page.locator.return_value.count.return_value = 0
    page.get_by_role.return_value.count.return_value = 0
    page.content.return_value = '"USER_ID":"1234"' if authenticated else '<html>not verified</html>'
    return page


class AccountTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Database(self.temp.name)
        self.accounts = Accounts(self.db)
        self.a = self.accounts.add('One')['id']
        self.b = self.accounts.add('Two')['id']

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def test_session_isolation_attributes_and_renewal(self):
        self.accounts.save(self.a,state())
        self.accounts.save(self.b,state('5678','separate-token'))
        s = requests.Session()
        load_jar(s,self.accounts.load(self.a))
        s.cookies.set_cookie(requests.cookies.create_cookie('xs','renewed-token',domain='.facebook.com',path='/',secure=True,rest={'HttpOnly':None,'SameSite':'Strict'}))
        updated = merged_state(self.accounts.load(self.a), s.cookies)
        self.accounts.save(self.a,updated)
        self.assertEqual(next(c['value'] for c in self.accounts.load(self.b)['cookies'] if c['name']=='xs'),'separate-token')
        self.assertEqual(next(c['value'] for c in self.accounts.load(self.a)['cookies'] if c['name']=='xs'),'renewed-token')
        cookie = next(c for c in updated['cookies'] if c['name']=='c_user')
        self.assertTrue(cookie['httpOnly'])
        self.assertEqual(cookie['domain'], '.facebook.com')
        self.assertEqual(self.accounts.path(self.a).stat().st_mode & 0o777,0o600)
        self.assertEqual(self.accounts.directory.stat().st_mode & 0o777,0o700)

    def test_account_verify_positive_and_expiry(self):
        self.accounts.save(self.a,state())
        with patch('requests.sessions.Session.request', return_value=response('"USER_ID":"1234"')):
            self.assertEqual(self.accounts.test(self.a)['status'],'authenticated')
        with patch('requests.sessions.Session.request', return_value=response(url='https://www.facebook.com/login/')):
            with self.assertRaises(CollectorError):
                self.accounts.test(self.a)
        self.assertEqual(self.accounts.get(self.a)['status'],'authentication_required')

    def test_unverified_homepage_is_not_auth_success(self):
        self.accounts.save(self.a,state())
        with patch('requests.sessions.Session.request', return_value=response('public home')):
            with self.assertRaises(CollectorError):
                self.accounts.test(self.a)
        self.assertNotEqual(self.accounts.get(self.a)['status'],'authenticated')

    def test_delete_only_selected_session(self):
        self.accounts.save(self.a,state())
        self.accounts.save(self.b,state('5678'))
        profile = self.accounts.profile_path(self.a)
        profile.mkdir(parents=True)
        (profile/'browser-state').write_text('synthetic')
        self.accounts.delete_session(self.a)
        self.assertFalse(self.accounts.path(self.a).exists())
        self.assertTrue(self.accounts.path(self.b).exists())
        self.assertFalse(profile.exists())

    def test_restricted_error_identifies_local_record_without_reading_cookies(self):
        self.db.execute("UPDATE accounts SET status='restricted',profile_id='1234' WHERE id=?",(self.a,))
        with patch.object(self.accounts,'path') as secret_path:
            with self.assertRaises(CollectorError) as caught:
                self.accounts.load(self.a)
        secret_path.assert_not_called()
        details = caught.exception.details
        self.assertEqual(details['account_id'],self.a)
        self.assertEqual(details['facebook_profile_id'],'1234')
        self.assertEqual(details['status_source'],'local_registry')
        self.assertFalse(details['facebook_request_made'])

    def test_interactive_browser_login_mock(self):
        # Exercises saving real Playwright-shaped state, without a browser/account.
        playwright = MagicMock()
        context = playwright.chromium.launch_persistent_context.return_value
        # Reproduce an original login tab remaining open while a second tab is logged in.
        context.pages = [browser_page('https://www.facebook.com/login/',False),
                         browser_page('https://www.facebook.com/profile.php?id=1234')]
        context.storage_state.return_value = state()
        with patch('playwright.sync_api.sync_playwright') as start, patch('builtins.input',return_value=''), patch.object(self.accounts,'test') as http_test:
            start.return_value.__enter__.return_value = playwright
            result = self.accounts.login(self.a)
        self.assertEqual(result['status'],'saved_unverified')
        self.assertTrue(result['session_saved'])
        self.assertTrue(result['browser_login_verified'])
        self.assertTrue(result['active'])
        self.assertEqual(self.accounts.active()['id'],self.a)
        self.assertFalse(result['http_session_verified'])
        http_test.assert_not_called()
        self.assertEqual(self.accounts.load(self.a)['cookies'][0]['value'],'1234')
        self.assertEqual(playwright.chromium.launch_persistent_context.call_args.args[0],str(self.accounts.profile_path(self.a)))
        context.close.assert_called_once()

    def test_incomplete_confirmation_keeps_browser_open_until_retry(self):
        playwright = MagicMock()
        context = playwright.chromium.launch_persistent_context.return_value
        page = browser_page('https://www.facebook.com/login/',False)
        context.pages = [page]
        context.storage_state.return_value = state()
        def confirm(*args):
            if confirm.calls:
                context.close.assert_not_called()
                page.url = 'https://www.facebook.com/'
                page.content.return_value = '"USER_ID":"1234"'
            confirm.calls += 1
            return ''
        confirm.calls = 0
        with patch('playwright.sync_api.sync_playwright') as start, patch('builtins.input',side_effect=confirm), patch('builtins.print'):
            start.return_value.__enter__.return_value = playwright
            self.assertTrue(self.accounts.login(self.a)['session_saved'])
        self.assertEqual(confirm.calls,2)

    def test_cancel_keeps_profile_but_does_not_export_unverified_cookies(self):
        playwright = MagicMock()
        context = playwright.chromium.launch_persistent_context.return_value
        with patch('playwright.sync_api.sync_playwright') as start, patch('builtins.input',return_value='cancel'):
            start.return_value.__enter__.return_value = playwright
            with self.assertRaises(CollectorError):
                self.accounts.login(self.a)
        self.assertTrue(self.accounts.profile_path(self.a).is_dir())
        self.assertFalse(self.accounts.path(self.a).exists())
        context.close.assert_called_once()

    def test_new_profile_imports_saved_cookies_once(self):
        self.accounts.save(self.a,state())
        playwright = MagicMock()
        context = playwright.chromium.launch_persistent_context.return_value
        context.pages = [browser_page()]
        context.storage_state.return_value = state()
        with patch('playwright.sync_api.sync_playwright') as start, patch('builtins.input',return_value=''):
            start.return_value.__enter__.return_value = playwright
            self.accounts.login(self.a)
            context.add_cookies.assert_called_once_with(state()['cookies'])
            (self.accounts.profile_path(self.a)/'Local State').write_text('synthetic')
            context.add_cookies.reset_mock()
            context.cookies.return_value = state()['cookies']
            self.accounts.login(self.a)
            context.add_cookies.assert_not_called()

    def test_context_does_not_load_upstream_state_files(self):
        self.accounts.save(self.a,state())
        adapter = FacebookGQL(self.db,self.a,'123')
        try:
            self.assertIs(adapter.context.session.verify,True)
            self.assertFalse(adapter.context.debug)
            self.assertEqual(adapter.context.operations,{})
            with self.assertRaises(CollectorError):
                adapter.context.post('SomeMutation','https://www.facebook.com/',{})
        finally:
            adapter.close()
        self.assertFalse((Path.cwd()/'facebook_state.json').exists())


class BrowserEvidenceTests(unittest.TestCase):
    def test_query_parameters_do_not_trigger_login_rejection(self):
        context = MagicMock()
        context.pages = [browser_page('https://www.facebook.com/profile.php?id=1234&next=/login/')]
        self.assertTrue(browser_login_evidence(context,state())['verified'])

    def test_cookie_pair_without_authenticated_page_is_not_success(self):
        context = MagicMock()
        context.pages = [browser_page(authenticated=False)]
        self.assertFalse(browser_login_evidence(context,state())['verified'])

    def test_active_new_challenge_overrides_old_authenticated_tab(self):
        context = MagicMock()
        context.pages = [browser_page(),browser_page('https://www.facebook.com/checkpoint/123',False)]
        evidence = browser_login_evidence(context,state())
        self.assertFalse(evidence['verified'])
        self.assertEqual(evidence['page_state'],'security_check')

    def test_missing_or_expired_cookies_do_not_prove_login(self):
        context = MagicMock()
        context.pages = [browser_page()]
        expired = state()
        expired['cookies'][1]['expires'] = 1
        self.assertFalse(browser_login_evidence(context,expired)['verified'])

    def test_swallowed_upstream_restriction_remains_latched(self):
        from facebook_gql_scraper.facebookGraphql import FacebookContext
        context = SafeContext(state(),'123',delay=0)
        def swallow(*args):
            try:
                context.session.get('https://www.facebook.com/')
            except CollectorError:
                pass  # Simulate upstream discovery's broad catch.
            return 'not-a-real-document-id'
        try:
            with patch.object(FacebookContext,'_resolve_doc_id',side_effect=swallow), patch('requests.sessions.Session.request',return_value=response(status=429)) as send:
                with self.assertRaises(CollectorError) as error:
                    context._resolve_doc_id('GroupsCometFeedRegularStoriesPaginationQuery_facebookRelayOperation','ignored')
                self.assertEqual(error.exception.code,'restricted')
                with self.assertRaises(CollectorError):
                    context.session.get('https://www.facebook.com/')
                self.assertEqual(send.call_count,1)
        finally:
            context.session.close()


class TransportTests(unittest.TestCase):
    def test_control_signals_and_no_post_text_false_positive(self):
        cases = [response(url='https://www.facebook.com/checkpoint/'),response(status=429),
                 response('<input name="pass">'),response('{"errors":[{"code":368}]}',content_type='application/json')]
        for r in cases:
            with self.assertRaises(CollectorError):
                check_response(r)
        check_response(response('{"data":{"message":"I am temporarily blocked from my driveway"}}',content_type='application/json'))

    def test_tls_timeouts_and_bounded_retry(self):
        s = GuardedSession(delay=0,retries=1)
        with patch('requests.sessions.Session.request', side_effect=[requests.Timeout('secret-token'),response()]) as send, patch('time.sleep'):
            s.get('https://www.facebook.com/')
            self.assertEqual(send.call_count,2)
            self.assertIs(send.call_args.kwargs['verify'],True)
            self.assertIn('timeout',send.call_args.kwargs)
        with patch('requests.sessions.Session.request',side_effect=requests.Timeout('secret-token')),patch('time.sleep'):
            with self.assertRaises(CollectorError) as error:
                s.get('https://www.facebook.com/')
            self.assertNotIn('secret-token',str(error.exception))

    def test_request_budget_and_restrictions_no_retries(self):
        s = GuardedSession(max_requests=1,delay=0)
        with patch('requests.sessions.Session.request',return_value=response(status=429)) as send:
            with self.assertRaises(CollectorError):
                s.get('https://www.facebook.com/')
            self.assertEqual(send.call_count,1)
        with self.assertRaises(CollectorError):
            s.get('https://www.facebook.com/')
        with self.assertRaises(CollectorError):
            GuardedSession().get('https://evil.example')

    def test_redirect_to_external_host_rejected(self):
        r = response(status=302)
        r.headers['location'] = 'https://evil.example/'
        with patch('requests.sessions.Session.request',return_value=r) as send:
            with self.assertRaises(CollectorError):
                GuardedSession(delay=0).get('https://www.facebook.com/')
            self.assertEqual(send.call_count,1)
