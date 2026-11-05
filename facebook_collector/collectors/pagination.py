"""Capture only an observed group-feed request contract, never auth headers.

No doc IDs are guessed and no cursor is shared across users or query types.
"""
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
import json

from ..accounts.manager import Accounts, browser_login_evidence
from ..errors import CollectorError, fail
from ..groups.manager import Groups
from ..storage.database import atomic_json, private_dir

FEED_NAME = 'GroupsCometFeedRegularStoriesPaginationQuery'
FEED_OPERATION = FEED_NAME + '_facebookRelayOperation'


def contract_from_request(url, body, friendly_name, gid):
    parsed = urlsplit(url)
    if (parsed.scheme != 'https' or parsed.hostname not in ('www.facebook.com','web.facebook.com','facebook.com')
            or parsed.path.rstrip('/') != '/api/graphql'):
        return None
    try:
        form = parse_qs(body or '', strict_parsing=False)
        name = form.get('fb_api_req_friendly_name',[friendly_name])[0]
        if name != FEED_NAME:
            return None
        variables = json.loads(form['variables'][0])
        doc_id = form['doc_id'][0]
        if (not isinstance(variables,dict) or str(variables.get('id')) != gid
                or 'cursor' not in variables or not doc_id.isdigit()):
            return None
        variables['cursor'] = None  # Fresh head of THIS operation, not the root-query cursor.
        return {'schema_version':1,'group_id':gid,'operation':FEED_OPERATION,
                'doc_id':doc_id,'variables':variables,'captured_at':datetime.now(timezone.utc).isoformat()}
    except (ValueError, KeyError, TypeError, IndexError):
        return None


def contract_path(db, aid, gid):
    Accounts(db).path(aid)  # validate registry ID, not cookie contents
    if not gid.isdigit():
        fail('invalid_group','Pagination contracts require a numeric group ID.')
    return db.directory / 'pagination' / aid / (gid + '.json')


def load_contract(db, aid, gid):
    path = contract_path(db,aid,gid)
    if not path.exists():
        return None
    if path.is_symlink() or path.stat().st_mode & 0o077:
        fail('unsafe_storage','Pagination contract must be a regular owner-only file.')
    try:
        data = json.loads(path.read_text())
        captured = datetime.fromisoformat(data['captured_at'])
        variables = data['variables']
        if (data.get('schema_version') != 1 or data.get('group_id') != gid or data.get('account_id') != aid
                or data.get('operation') != FEED_OPERATION or not str(data.get('doc_id','')).isdigit()
                or not isinstance(variables,dict) or str(variables.get('id')) != gid or 'cursor' not in variables
                or captured.tzinfo is None):
            raise ValueError()
        if datetime.now(timezone.utc) - captured > timedelta(days=1):
            fail('pagination_contract_expired','The observed feed contract is over 24 hours old. Capture it again; no fallback requests were made.')
        return data
    except CollectorError:
        raise
    except (OSError,ValueError,KeyError,TypeError):
        fail('pagination_contract_invalid','The saved pagination contract is invalid; capture it again.')


def capture(db, gid, account=None, auto=False):
    """Normal visible browser navigation, at most one automatic scroll.

    Manual mode permits the operator to choose New posts and scroll themselves.
    Security checks are never solved or bypassed.
    """
    groups, accounts = Groups(db), Accounts(db)
    group = groups.get(gid)
    aid = groups.select_account(group,account)
    with db.lock('group:' + gid), db.lock('account:' + aid):
        state = accounts.load(aid)
        from playwright.sync_api import sync_playwright
        profile = accounts.profile_path(aid)
        private_dir(profile.parent)
        private_dir(profile)
        observed = []
        request_counts = {'graphql_posts': 0, 'supported_feed_requests': 0}
        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(str(profile),headless=False)
            try:
                # Restore legitimately renewed HTTP cookies to this account's own context.
                context.add_cookies(state['cookies'])
                def on_request(request):
                    if request.method != 'POST':
                        return
                    parsed = urlsplit(request.url)
                    if parsed.hostname in ('www.facebook.com','web.facebook.com','facebook.com') and parsed.path.rstrip('/') == '/api/graphql':
                        request_counts['graphql_posts'] += 1
                    candidate = contract_from_request(request.url,request.post_data,
                                                     request.headers.get('x-fb-friendly-name',''),gid)
                    if candidate:
                        observed.append(candidate)
                        request_counts['supported_feed_requests'] += 1
                context.on('request',on_request)
                page = context.pages[0] if context.pages else context.new_page()
                page.goto(group['url'],wait_until='domcontentloaded',timeout=30000)
                page.wait_for_timeout(8000)
                attempts = 2 if auto else 4
                for attempt in range(attempts):
                    snapshot = context.storage_state()
                    evidence = browser_login_evidence(context,snapshot)
                    if evidence['page_state'] == 'security_check':
                        fail('restricted','Facebook requested a security check. Capture stopped without saving a contract.')
                    if not evidence['verified']:
                        fail('authentication_unverified','Authenticated browser access could not be confirmed; capture stopped.')
                    if observed and (auto or attempt > 0):
                        break
                    if attempt == attempts - 1:
                        break
                    if auto:
                        page.mouse.wheel(0,1600)
                        page.wait_for_timeout(8000)
                    else:
                        answer = input('In this group, select New posts if available and scroll until more posts load. Then press Enter here (cancel to stop): ')
                        if answer.strip().lower() in ('cancel','q','quit'):
                            fail('capture_cancelled','Pagination capture cancelled.')
                        # input() blocks Playwright's synchronous event dispatcher.
                        # Pump queued browser events before deciding capture failed.
                        page.wait_for_timeout(2000)
                        if not observed and attempt < attempts - 2:
                            print('No supported feed request captured yet. Keep this browser open, scroll farther until additional posts load, then press Enter again.', flush=True)
                if not observed:
                    raise CollectorError('pagination_not_observed', 'No supported group-feed request was captured after the browser steps. Collection did not start.', details={**request_counts, 'capture_attempts': attempts - 1, 'possible_causes': ['No additional posts loaded', 'Facebook used a different feed request format']})
                candidate = {**observed[-1],'account_id':aid}
                atomic_json(contract_path(db,aid,gid),candidate)
                accounts.save(aid,context.storage_state())
                return {'group_id':gid,'account_id':aid,'pagination_contract_saved':True,
                        'operation':FEED_NAME,'sorting':candidate['variables'].get('sortingSetting'),
                        'message':'Observed request saved without cookies/CSRF headers. HTTP page-two compatibility still needs validation.'}
            except CollectorError as error:
                if error.code in ('restricted','authentication_required'):
                    accounts.record_error(aid,error)
                    db.execute('UPDATE group_access SET status=?,last_checked_at=? WHERE group_id=? AND account_id=?',
                               (error.code,datetime.now(timezone.utc).isoformat(),gid,aid))
                raise
            finally:
                context.close()


def ensure_sorting(db, gid, account, sorting):
    """Prepare the requested feed order within the same interactive sync command."""
    group = Groups(db).get(gid)
    aid = Groups(db).select_account(group, account)
    expected = {'chronological': 'CHRONOLOGICAL', 'top': 'TOP_POSTS'}[sorting]
    try:
        descriptor = load_contract(db, aid, group['id'])
    except CollectorError as error:
        if error.code not in ('pagination_contract_expired', 'pagination_contract_invalid'):
            raise
        descriptor = None
    if descriptor and descriptor['variables'].get('sortingSetting') == expected:
        return
    label = 'New posts' if sorting == 'chronological' else 'Top posts'
    print(f'Opening Facebook: select {label}, scroll until more posts load, then press Enter here. Collection will continue automatically.', flush=True)
    capture(db, group['id'], account=aid)
    descriptor = load_contract(db, aid, group['id'])
    if not descriptor or descriptor['variables'].get('sortingSetting') != expected:
        fail('feed_sorting_unverified', f'The requested {label} order was not observed. No collection started; select that order when running the command again.')
