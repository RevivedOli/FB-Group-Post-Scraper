from http.cookiejar import Cookie
import json
import os
from pathlib import Path
import re
import shutil
import time
import uuid
from urllib.parse import urlsplit

from ..errors import CollectorError, fail
from ..storage.database import atomic_json, now, private_dir
from ..transport import GuardedSession


def allowed_cookie(cookie):
    return cookie.get('domain', '').lstrip('.') in ('facebook.com', 'www.facebook.com', 'web.facebook.com')


def live_login_cookies(state):
    return {c['name']: c['value'] for c in state.get('cookies', [])
            if allowed_cookie(c) and c.get('value') and
            (c.get('expires', -1) <= 0 or c['expires'] > time.time())}


def browser_login_evidence(context, state):
    """Inspect all tabs, not just the tab originally opened for login.

    Return only non-secret evidence. A cookie alone is not positive login proof.
    Match routes by path so a next=/login query cannot reject a real profile page.
    """
    cookies = live_login_cookies(state)
    evidence = {'verified': False, 'cookie_pair_present': {'c_user', 'xs'} <= cookies.keys(),
                'facebook_tabs': 0, 'page_state': 'no_facebook_tab'}
    pages = []
    for page in context.pages:
        if page.is_closed():
            continue
        url = urlsplit(page.url)
        if url.scheme == 'https' and url.hostname in ('facebook.com', 'www.facebook.com', 'web.facebook.com'):
            pages.append((page, url.path.lower()))
    evidence['facebook_tabs'] = len(pages)
    for page, path in reversed(pages):
        if any(path in (prefix, prefix + '.php') or path.startswith(prefix + '/') for prefix in
               ('/checkpoint', '/challenge', '/two_step_verification', '/confirmidentity')):
            evidence['page_state'] = 'security_check'
            # A newly opened security-check tab overrides an older logged-in tab.
            return evidence
        if path in ('/login', '/login/', '/login.php') or path.startswith('/login/'):
            evidence['page_state'] = 'login_page'
            continue
        evidence['page_state'] = 'unverified_page'
        if not evidence['cookie_pair_present']:
            continue
        try:
            password = page.locator('input[type="password"]')
            if any(password.nth(i).is_visible() for i in range(password.count())):
                evidence['page_state'] = 'login_form'
                continue
            content = page.content()
            own = re.escape(cookies['c_user'])
            identity = bool(re.search(r'"(?:USER_ID|ACCOUNT_ID|actorID|viewerID)"\s*:\s*"' + own + r'"', content))
            account_controls = page.get_by_role('button', name=re.compile(r'^(Your profile|Your account|Account controls)$', re.I))
            controls_visible = any(account_controls.nth(i).is_visible() for i in range(account_controls.count()))
            if identity or controls_visible:
                return {**evidence, 'verified': True, 'page_state': 'authenticated_page'}
        except Exception:
            # A navigation/closed tab during confirmation is inconclusive, not logout.
            continue
    return evidence


def load_jar(session, state):
    """Preserve domain/path/expiry/security and extension attributes."""
    for item in state.get('cookies', []):
        if not allowed_cookie(item):
            continue
        domain = item['domain']
        expiry = item.get('expires', -1)
        rest = {'SameSite': item.get('sameSite', 'Lax')}
        if item.get('httpOnly'):
            rest['HttpOnly'] = None
        session.cookies.set_cookie(Cookie(
            version=0, name=item['name'], value=item['value'], port=None, port_specified=False,
            domain=domain, domain_specified=domain.startswith('.'), domain_initial_dot=domain.startswith('.'),
            path=item.get('path', '/'), path_specified=True, secure=item.get('secure', True),
            expires=int(expiry) if expiry and expiry > 0 else None, discard=not (expiry and expiry > 0),
            comment=None, comment_url=None, rest=rest, rfc2109=False))


def merged_state(state, jar):
    # Requests holds server-issued replacements; retain browser-only attributes for
    # surviving cookies, plus localStorage/origins from the interactive login.
    original = {(c['domain'], c.get('path', '/'), c['name']): c for c in state.get('cookies', []) if allowed_cookie(c)}
    cookies = []
    for cookie in jar:
        key = (cookie.domain, cookie.path, cookie.name)
        item = dict(original.get(key, {}))
        item.update(name=cookie.name, value=cookie.value, domain=cookie.domain,
                    path=cookie.path, secure=cookie.secure, expires=cookie.expires or -1)
        rest = cookie._rest
        item['httpOnly'] = any(k.lower() == 'httponly' for k in rest)
        item['sameSite'] = rest.get('SameSite', item.get('sameSite', 'Lax'))
        if allowed_cookie(item) and not cookie.is_expired():
            cookies.append(item)
    return {**state, 'cookies': cookies}


class Accounts:
    def __init__(self, db):
        self.db = db
        self.directory = private_dir(db.directory / 'sessions')

    def add(self, label):
        aid = 'fb_' + uuid.uuid4().hex[:12]
        self.db.execute('INSERT INTO accounts(id,label) VALUES(?,?)', (aid, label))
        return self.get(aid)

    def get(self, aid):
        row = self.db.one('SELECT * FROM accounts WHERE id=?', (aid,))
        if not row:
            fail('unknown_account', 'Account is not registered.')
        return row

    def active(self):
        row = self.db.one('SELECT active_account FROM local_preferences WHERE id=1')
        return self.get(row['active_account']) if row and row['active_account'] else None

    def use(self, aid):
        account = self.get(aid)
        if account['status'] not in ('authenticated', 'saved_unverified'):
            fail('account_not_ready', 'This account has no usable saved login; its status was not changed.')
        if not self.path(aid).is_file():
            fail('authentication_required', 'This account has no saved session.')
        self.db.execute('INSERT INTO local_preferences(id,active_account) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET active_account=excluded.active_account', (aid,))
        return {**account, 'active': True}

    def clear_active(self):
        self.db.execute('UPDATE local_preferences SET active_account=NULL WHERE id=1')

    def path(self, aid):
        self.get(aid)  # IDs come from the registry, never a supplied path.
        if not re.fullmatch(r'fb_[a-f0-9]{12}', aid):
            fail('unsafe_storage', 'Invalid account identifier.')
        return self.directory / (aid + '.json')

    def save(self, aid, state):
        cookies = [c for c in state.get('cookies', []) if allowed_cookie(c)]
        if not {'c_user', 'xs'}.issubset({c['name'] for c in cookies}):
            fail('authentication_required', 'The session does not contain the required Facebook cookies.')
        atomic_json(self.path(aid), {**state, 'cookies': cookies})

    def profile_path(self, aid):
        self.path(aid)  # Same registry/identifier validation as session filenames.
        return self.db.directory / 'profiles' / aid

    def load(self, aid, allow_unhealthy=False):
        account = self.get(aid)
        if not allow_unhealthy and account['status'] in ('restricted', 'authentication_required'):
            raise CollectorError(account['status'],
                'Collection is paused by this account record\'s saved local status; this is not a fresh Facebook suspension check.',
                {'account_id': aid, 'facebook_profile_id': account['profile_id'],
                 'local_status': account['status'], 'status_source': 'local_registry',
                 'last_checked_at': account['last_checked_at'], 'facebook_request_made': False})
        path = self.path(aid)
        if not path.exists():
            fail('authentication_required', 'No saved session; run account login.')
        if path.is_symlink() or path.stat().st_mode & 0o077:
            fail('unsafe_storage', 'Session must be a regular, owner-only file (chmod 600).')
        try:
            state = json.loads(path.read_text())
            if not isinstance(state.get('cookies'), list):
                raise ValueError()
            return state
        except (ValueError, OSError, AttributeError):
            fail('authentication_required', 'Saved session cannot be read; re-authenticate.')

    def record_error(self, aid, error):
        status = error.code if error.code in ('restricted', 'authentication_required', 'authentication_unverified') else self.get(aid)['status']
        self.db.execute('UPDATE accounts SET status=?,last_error=?,last_checked_at=? WHERE id=?',
                        (status, error.code, now(), aid))

    def login(self, aid):
        self.get(aid)
        with self.db.lock('account:' + aid):
            from playwright.sync_api import sync_playwright
            profile = self.profile_path(aid)
            if profile.is_symlink():
                fail('unsafe_storage', 'Browser profile must not be a symbolic link.')
            existing_profile = profile.exists() and any(profile.iterdir())
            private_dir(profile.parent)
            private_dir(profile)
            with sync_playwright() as p:
                context = p.chromium.launch_persistent_context(str(profile), headless=False)
                try:
                    # Migrate an earlier cookie snapshot into a new dedicated profile.
                    # Existing profiles keep their genuine browser/device state.
                    if self.path(aid).exists():
                        saved = self.load(aid, allow_unhealthy=True)
                        current = live_login_cookies({'cookies': context.cookies()})
                        if not existing_profile:
                            context.add_cookies(saved['cookies'])
                        elif not {'c_user', 'xs'} <= current.keys():
                            # Session cookies can disappear on browser shutdown.
                            # Restore missing login cookies without replacing the
                            # profile's genuine device/preferences cookies.
                            missing = [c for c in saved['cookies']
                                       if c['name'] in ('c_user', 'xs') and c['name'] not in current]
                            if missing:
                                context.add_cookies(missing)
                    page = context.pages[0] if context.pages else context.new_page()
                    try:
                        page.goto('https://www.facebook.com/', wait_until='domcontentloaded', timeout=30000)
                    except Exception:
                        print('Initial navigation did not finish. You can continue in the browser and confirm below.')
                    while True:
                        answer = input('Log in and complete checks manually in any tab. When your account is visible, press Enter (or type cancel): ')
                        if answer.strip().lower() in ('cancel', 'quit', 'q'):
                            fail('authentication_required', 'Login cancelled. Dedicated browser profile preserved; retry account login with the same account ID.')
                        state = context.storage_state()
                        evidence = browser_login_evidence(context, state)
                        if not evidence['verified']:
                            print('Login not confirmed yet: ' + evidence['page_state'] +
                                  '; Facebook tabs=' + str(evidence['facebook_tabs']) +
                                  '; required cookies=' + ('present' if evidence['cookie_pair_present'] else 'missing') +
                                  '. Browser stays open; complete verification normally, then press Enter again.')
                            continue
                        self.save(aid, state)
                        stamp = now()
                        self.db.execute('UPDATE accounts SET status=?,profile_id=?,last_authenticated_at=?,last_error=NULL WHERE id=?',
                                        ('saved_unverified', live_login_cookies(state)['c_user'], stamp, aid))
                        break
                finally:
                    context.close()
        self.use(aid)
        return {**self.get(aid), 'active': True, 'session_saved': True, 'browser_login_verified': True,
                'http_session_verified': False,
                'message': 'Browser login saved. Run account test separately to verify access from the HTTP collector.'}

    def test(self, aid):
        with self.db.lock('account:' + aid):
            state = self.load(aid, allow_unhealthy=True)
            session = GuardedSession(max_requests=8)
            load_jar(session, state)
            try:
                response = session.get('https://www.facebook.com/')
                own = next((c['value'] for c in state['cookies'] if c['name'] == 'c_user'), None)
                matches = re.findall(r'"(?:USER_ID|ACCOUNT_ID|actorID|viewerID)"\s*:\s*"(\d+)"', response.text)
                if not own or own not in matches:
                    fail('authentication_unverified', 'Authentication could not be positively verified from the account page.')
                self.save(aid, merged_state(state, session.cookies))
                self.db.execute('UPDATE accounts SET status=?,profile_id=?,last_checked_at=?,last_error=NULL WHERE id=?',
                                ('authenticated', own, now(), aid))
                return self.get(aid)
            except CollectorError as error:
                self.record_error(aid, error)
                raise
            finally:
                session.close()

    def delete_session(self, aid):
        with self.db.lock('account:' + aid):
            self.path(aid).unlink(missing_ok=True)
            profile = self.profile_path(aid)
            if profile.is_symlink():
                fail('unsafe_storage', 'Browser profile must not be a symbolic link.')
            if profile.exists():
                shutil.rmtree(profile)
            self.db.execute("UPDATE accounts SET status='not_authenticated',last_error=NULL WHERE id=?", (aid,))
            self.db.execute('UPDATE local_preferences SET active_account=NULL WHERE active_account=?', (aid,))
