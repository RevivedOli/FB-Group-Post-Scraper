"""Thin hardened wrapper around the pinned upstream query classes/parser.

No credentials or tokens are passed to the SDK constructor's file loader.
Only group metadata/feed operations are exposed; comments/profiles are unused.
"""
from contextlib import redirect_stdout, redirect_stderr
from copy import deepcopy
from datetime import datetime, timezone
import io
import json
import logging
import re
import time
import random
from urllib.parse import urlsplit

from facebook_gql_scraper.facebookGraphql import (
    FacebookContext, GroupsCometFeedRegularStoriesPaginationQueryGraphQL,
)
from facebook_gql_scraper.facebookOperationDiscovery import FacebookOperationDiscovery
from facebook_gql_scraper.facebookConsolidater import consolidate_jsonl, apply_patch as apply_fragment
from facebook_gql_scraper.unifiedFacebookParser import parse_facebook_payload
from facebook_gql_scraper import Group

from ..accounts.manager import Accounts, load_jar, merged_state
from ..errors import CollectorError, fail
from ..transport import GuardedSession
from ..storage.database import atomic_json
from .base import Page
from .bootstrap import read_bootstrap
from .pagination import load_contract, FEED_OPERATION

UPSTREAM_REVISION = '3933a99a4eaac2e04754165b0ad7582b1ba452e9'
ALLOWED_OPERATIONS = {
    'GroupsCometFeedRegularStoriesPaginationQuery_facebookRelayOperation',
    'CometHovercardQueryRendererQuery$Parameters',
    'CometGroupAboutRootQuery_facebookRelayOperation',
    'CometGroupDiscussionRootSuccessQuery_facebookRelayOperation',
}


def quiet_call(function, *args, **kwargs):
    # Upstream consolidator prints malformed fragment paths; never leak these.
    with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
        return function(*args, **kwargs)


def consolidate(raw):
    try:
        raw = raw.removeprefix('for (;;);')
        frames = [json.loads(line) for line in raw.splitlines() if line.strip()]
        base = next((f for f in frames if isinstance(f, dict) and 'path' not in f), None)
        preview = deepcopy(base)
        # The upstream merger silently ignores a patch whose parent is a scalar.
        # Reject that case before accepting an apparently complete response.
        for frame in frames:
            if not isinstance(frame, dict):
                raise ValueError()
            if 'path' in frame:
                if not isinstance(frame['path'], list) or 'data' not in frame:
                    raise ValueError()
                # GraphQL incremental paths are relative to the initial `data`
                # object. Upstream attaches these fragments beside data instead,
                # leaving placeholder edges and pagination metadata unfilled.
                if (frame['path'] and frame['path'][0] != 'data' and isinstance(base,dict)
                        and isinstance(base.get('data'),dict) and frame['path'][0] in base['data']):
                    frame['path'] = ['data'] + frame['path']
                current = preview
                for key in frame['path'][:-1]:
                    if isinstance(current, dict):
                        current = current.get(key, {})
                    elif isinstance(current, list) and isinstance(key, int) and key >= 0:
                        current = current[key] if key < len(current) else {}
                    else:
                        raise ValueError()
                if frame['path'] and not isinstance(current, (dict, list)):
                    raise ValueError()
                preview = apply_fragment(preview,frame['path'],frame['data'])
        output = io.StringIO()
        with redirect_stdout(output), redirect_stderr(output):
            result = consolidate_jsonl('\n'.join(json.dumps(frame) for frame in frames))
        # Upstream may return a partial object after a failed deferred patch.
        if output.getvalue() or not isinstance(result, dict):
            raise ValueError()
        return result
    except (ValueError, TypeError, KeyError, IndexError, AttributeError):
        fail('parser_error', 'Malformed Facebook JSON/fragment structure.')


def parse_page(raw, gid, allow_partial=False):
    document = consolidate(raw)
    entity = document.get('data', {}).get('node', document.get('node', {}))
    if not isinstance(entity, dict) or str(entity.get('id', '')) != gid or entity.get('__typename') != 'Group':
        fail('parser_error', 'Response is not the requested group feed.')
    feed = entity.get('group_feed')
    if not isinstance(feed, dict) or not isinstance(feed.get('edges'), list):
        fail('access_unverified', 'The group response contains no verifiable discussion feed.')
    source_count = sum(bool((e.get('node') or {}).get('post_id')) for e in feed['edges'] if isinstance(e, dict) and isinstance(e.get('node'), dict))
    explicit_empty_end = (not feed['edges'] and isinstance(feed.get('page_info'),dict)
                          and feed['page_info'].get('has_next_page') is False)
    if allow_partial and source_count == 0 and not explicit_empty_end:
        raise CollectorError('feed_not_loaded',
            'Facebook returned group layout/feed units but no identifiable post batch. This does not mean the group has no posts.',
            {'feed_unit_count': len(feed['edges']), 'post_node_count': 0,
             'pagination_present': isinstance(feed.get('page_info'), dict),
             'request_operation': 'CometGroupDiscussionRootSuccessQuery'})
    info = feed.get('page_info')
    pagination_known = isinstance(info, dict) and type(info.get('has_next_page')) is bool
    if not pagination_known and not allow_partial:
        fail('parser_error', 'Feed pagination metadata is missing or ambiguous.')
    if pagination_known and info['has_next_page'] and (not isinstance(info.get('end_cursor'), str) or not info.get('end_cursor')):
        fail('parser_error', 'Feed claims another page without a valid cursor.')
    try:
        for edge in feed['edges']:
            # Author identities are not needed, and upstream crashes on actors=[].
            if isinstance(edge, dict) and isinstance(edge.get('node'), dict):
                edge['node']['actors'] = [{}]
        parsed = quiet_call(parse_facebook_payload, document)
        if not parsed or parsed.get('operation') != 'GroupsCometFeedRegularStoriesPaginationQuery':
            raise ValueError()
        records = parsed['parsed_data']['posts']
        if len(records) != source_count:
            raise ValueError()
        posts = [normalize(post, gid) for post in records]
        return Page(posts, info['has_next_page'] if pagination_known else None,
                    info.get('end_cursor') if pagination_known else None,
                    continuation_supported=pagination_known)
    except (ValueError, TypeError, KeyError, IndexError, AttributeError):
        fail('parser_error', 'The upstream parser no longer matches the group response.')


def normalize(post, gid):
    pid = str(post.get('id') or '')
    if not re.fullmatch(r'[0-9]+', pid):
        fail('unstable_identity', 'Post has no stable numeric source post ID; it was not stored or exported.')
    published = None
    if post.get('creation_time') is not None:
        try:
            published = datetime.fromtimestamp(float(post['creation_time']), timezone.utc).isoformat(timespec='microseconds')
        except (ValueError, TypeError, OverflowError, OSError):
            fail('parser_error', 'Post publication time is invalid.')
    text = post.get('text')
    if text is not None and not isinstance(text, str):
        fail('parser_error', 'Post text is malformed.')
    url = post.get('url')
    if url is not None:
        parsed = urlsplit(url)
        if (parsed.scheme != 'https' or parsed.hostname not in ('www.facebook.com', 'web.facebook.com', 'facebook.com')
                or parsed.username or parsed.password or parsed.port
                or not re.fullmatch(r'/groups/' + re.escape(gid) + r'/(posts|permalink)/(\d+|pfbid[A-Za-z0-9]+)/?', parsed.path)):
            fail('parser_error', 'Source permalink is not a post in the requested group.')
        # Numeric source link must agree with stable post identity.
        tail = parsed.path.rstrip('/').split('/')[-1]
        if tail.isdigit() and tail != pid:
            fail('parser_error', 'Post identity and source permalink disagree.')
        url = 'https://www.facebook.com' + parsed.path.rstrip('/')
    return {'group_id': gid, 'post_id': pid, 'post_url': url, 'text': text,
            'published_at': published, 'collector': 'facebook_gql'}


class SafeContext(FacebookContext):
    def __init__(self, state, gid, max_requests=100, delay=2, deadline=180, delay_max=None):
        # Deliberately avoid upstream constructor (cookie flattening, plaintext
        # token-state files and proxy/TLS options). Query and discovery code reused.
        for name in ('facebook_gql_scraper.facebookGraphql', 'facebook_gql_scraper.facebookOperationDiscovery'):
            logging.getLogger(name).disabled = True
        self.session = GuardedSession(max_requests, delay, deadline, delay_max=delay_max)
        load_jar(self.session, state)
        self.session.headers.update({'User-Agent': 'LocalFacebookCollector/0.1',
                                     'Accept-Language': 'en-GB,en;q=0.9'})
        self.operations, self.page_operations = {}, {}
        self.fb_dtsg = None
        self.quiet, self.debug = True, False
        self.gid = gid
        self.operation_discovery = FacebookOperationDiscovery(self)
        self.operation_discovery.timeout_sec = 2
        self.observed_feed_contract = False

    def _save_state(self):
        pass  # Tokens/operation IDs remain memory-only; account cookie state is saved by our manager.

    def _invalidate_doc_id(self, operation_name, reference_page_url):
        if self.observed_feed_contract and operation_name == FEED_OPERATION:
            self.operations.pop(operation_name,None)
            fail('pagination_contract_expired','Facebook rejected the observed pagination query ID. Capture it again; no discovery fallback was attempted.')
        return super()._invalidate_doc_id(operation_name,reference_page_url)

    def _resolve_doc_id(self, operation_name, reference_page_url):
        if operation_name not in ALLOWED_OPERATIONS:
            fail('unsafe_request', 'The collector only allows group metadata and feed queries.')
        suffix = '/about' if 'About' in operation_name else ''
        try:
            result = super()._resolve_doc_id(operation_name, f'https://www.facebook.com/groups/{self.gid}{suffix}')
        except Exception:
            if self.session.terminal_error:
                raise self.session.terminal_error
            raise
        if self.session.terminal_error:
            raise self.session.terminal_error
        return result

    def post(self, operation_name, reference_page_url, variables, _retry=True):
        if operation_name not in ALLOWED_OPERATIONS:
            fail('unsafe_request', 'Unexpected operation; no request sent.')
        return super().post(operation_name, reference_page_url, variables, _retry)

    def debug_response(self, *args, **kwargs):
        fail('unsafe_debug', 'Credential-bearing upstream debug output is disabled.')

    def parse_graphql_response(self, raw):
        result = quiet_call(parse_facebook_payload, consolidate(raw))
        if not result:
            fail('parser_error', 'Unrecognised Facebook response schema.')
        return result


class FacebookGQL:
    def __init__(self, db, account_id, group_id, page_delay=10, page_delay_max=None, **options):
        self.accounts = Accounts(db)
        self.aid = account_id
        self.state = self.accounts.load(account_id)
        self.context = SafeContext(self.state, group_id, **options)
        self.bootstrap = None
        self.db = db
        self.page_delay = page_delay
        self.page_delay_max = page_delay if page_delay_max is None else page_delay_max
        self.feed_sorting = None

    def _bootstrap(self, group_id):
        if self.bootstrap is None:
            response = self.context.get('https://www.facebook.com/groups/' + group_id)
            self.bootstrap = read_bootstrap(response.text, group_id)
            if self.bootstrap['token']:
                self.context.fb_dtsg = self.bootstrap['token']
        return self.bootstrap

    def get_group_info(self, group_id):
        try:
            bootstrap = self._bootstrap(group_id)
            return {key: bootstrap[key] for key in ('group_id', 'name', 'url', 'privacy')}
        except CollectorError:
            raise
        except Exception as error:
            if type(error).__name__ == 'SessionExpiredError':
                fail('authentication_required', 'Facebook invalidated the saved session.')
            fail('parser_error', 'Group metadata response did not match the expected bootstrap format.')

    def legacy_pages(self, group_id):
        """Pinned SDK cursor implementation, retained for offline compatibility tests.

        Not selected automatically: its discovery path was not live validated.
        """
        query = GroupsCometFeedRegularStoriesPaginationQueryGraphQL(self.context)
        cursor, seen = None, set()
        while True:
            try:
                response = quiet_call(query.send, groupId=group_id, cursor=cursor, sortingSetting='CHRONOLOGICAL')
                page = parse_page(response.text, group_id)
            except CollectorError:
                raise
            except Exception as error:
                # Never surface upstream exception values (tokens/response text).
                if type(error).__name__ == 'SessionExpiredError':
                    fail('authentication_required', 'Facebook invalidated the saved session.')
                fail('parser_error', 'The pinned library could not retrieve this feed; no successful coverage checkpoint was advanced.')
            if page.has_next and (not page.cursor or page.cursor in seen):
                fail('pagination_error', 'Facebook returned a missing/repeated cursor.')
            if page.cursor:
                seen.add(page.cursor)
            yield page
            if not page.has_next:
                break
            cursor = page.cursor

    def pages(self, group_id):
        self._bootstrap(group_id)  # Verify the requested group, not the cache's source group.
        try:
            contract = load_contract(self.db, self.aid, group_id)
        except CollectorError as error:
            if error.code not in ('pagination_contract_expired', 'pagination_contract_invalid'):
                raise
            contract = None
        if contract is None:
            contract = self.automatic_contract(group_id)
        contract = deepcopy(contract)
        contract.update(source='automatic', captured_at=datetime.now(timezone.utc).isoformat())
        yield from self.captured_pages(group_id, contract)

    def automatic_contract(self, group_id):
        # A Relay operation ID identifies the query, not a particular group. The
        # SDK also caches IDs globally and supplies group identity in variables.
        # Reuse only this account's current query template; never reuse its cursor.
        directory = self.db.directory / 'pagination' / self.aid
        contract = None
        for path in sorted(directory.glob('*.json')):
            try:
                candidate = load_contract(self.db, self.aid, path.stem)
            except CollectorError as error:
                if error.code in ('pagination_contract_expired', 'pagination_contract_invalid'):
                    continue
                raise
            if candidate:
                contract = deepcopy(candidate)
                break
        if contract is None:
            try:
                doc_id = quiet_call(self.context._resolve_doc_id, FEED_OPERATION,
                                    'https://www.facebook.com/groups/' + group_id)
            except CollectorError:
                raise
            except Exception:
                fail('pagination_discovery_failed', 'The pagination operation could not be discovered for this login. No first-page-only success was reported.')
            contract = {'schema_version':1, 'operation':FEED_OPERATION, 'doc_id':doc_id,
                        'variables':deepcopy(GroupsCometFeedRegularStoriesPaginationQueryGraphQL.VARIABLES)}
        variables = contract['variables']
        # Only documented SDK arguments/provider flags are portable. No topic or
        # focused-comment filters, source IDs or opaque cursors are copied.
        variables = {key:value for key,value in variables.items()
                     if key in GroupsCometFeedRegularStoriesPaginationQueryGraphQL.VARIABLES
                     or key.startswith('__relay_internal__pv__')}
        variables.update(id=group_id, youthIntegrityHostID=group_id, cursor=None,
                         filterTopicId=None, focusCommentID=None)
        variables.setdefault('sortingSetting', 'TOP_POSTS')
        contract.update(group_id=group_id, account_id=self.aid, variables=variables,
                        source='automatic', captured_at=datetime.now(timezone.utc).isoformat())
        return contract

    def captured_pages(self, group_id, contract):
        self.feed_sorting = contract['variables'].get('sortingSetting')
        self._bootstrap(group_id)  # obtain fresh per-session request token
        self.context.observed_feed_contract = contract.get('source') != 'automatic'
        self.context.operations[FEED_OPERATION] = contract['doc_id']
        cursor, seen_cursors, seen_ids, page_number = None, set(), set(), 0
        while True:
            if page_number:
                delay = random.uniform(self.page_delay, self.page_delay_max)
                if time.monotonic() + delay >= self.context.session.deadline:
                    fail('request_budget', 'The next page pause exceeds this group’s remaining time budget; coverage is partial.')
                time.sleep(delay)
            variables = dict(contract['variables'])
            variables['cursor'] = cursor
            if 'count' in variables:
                if type(variables['count']) is not int or variables['count'] < 1:
                    fail('pagination_contract_invalid','Observed page size is invalid; capture again.')
                variables['count'] = min(variables['count'],10)
            try:
                response = self.context.post(FEED_OPERATION,'https://www.facebook.com/groups/' + group_id,variables)
                document = consolidate(response.text)
                if isinstance(document.get('data',{}).get('group'),dict):
                    group = document['data']['group']
                    document = {'data':{'node':{**group,'__typename':'Group'}}}
                page = parse_page(json.dumps(document),group_id,allow_partial=True)
            except CollectorError:
                raise
            except Exception as error:
                if type(error).__name__ == 'SessionExpiredError':
                    fail('authentication_required','Facebook invalidated the saved session.')
                fail('parser_error','Observed pagination response no longer matches the pinned parser.')
            if page_number == 0 and contract.get('source') == 'automatic':
                from .pagination import contract_path
                contract['doc_id'] = self.context.operations[FEED_OPERATION]
                atomic_json(contract_path(self.db, self.aid, group_id), contract)
            ids = {post['post_id'] for post in page.posts}
            if page.has_next is True:
                if not page.cursor or page.cursor in seen_cursors or (page_number and not ids.difference(seen_ids)):
                    fail('pagination_error','Pagination repeated a cursor or returned no new source IDs; scanning stopped.')
                seen_cursors.add(page.cursor)
            seen_ids.update(ids)
            page.continuation_supported = page.has_next is not None
            page_number += 1
            yield page
            if page.has_next is not True:
                return
            cursor = page.cursor

    def bootstrap_page(self, group_id):
        """First feed page via the current page's descriptor, not a fixed doc ID."""
        bootstrap = self._bootstrap(group_id)
        descriptor = bootstrap['discussion']
        if not descriptor:
            fail('feed_operation_unavailable', 'No discussion query for this group was supplied by Facebook.')
        variables = dict(descriptor['variables'])
        if 'regular_stories_count' not in variables:
            fail('parser_error', 'Discussion query no longer exposes a supported post-count parameter.')
        variables['regular_stories_count'] = 10
        if 'regular_stories_stream_initial_count' in variables:
            variables['regular_stories_stream_initial_count'] = 10
        if 'shouldDeferMainFeed' in variables:
            variables['shouldDeferMainFeed'] = False
        operation = 'CometGroupDiscussionRootSuccessQuery_facebookRelayOperation'
        self.context.operations[operation] = descriptor['id']
        try:
            response = self.context.post(operation, bootstrap['url'], variables)
        except CollectorError:
            raise
        except Exception as error:
            if type(error).__name__ == 'SessionExpiredError':
                fail('authentication_required', 'Facebook invalidated the saved session.')
            fail('feed_operation_unavailable', 'The page-provided discussion query could not be retrieved using the pinned library.')
        document = consolidate(response.text)
        group = document.get('data', {}).get('group')
        if not isinstance(group, dict) or str(group.get('id')) != group_id:
            fail('parser_error', 'Discussion response did not identify the requested group.')
        # The SDK's feed parser expects data.node; the current root query uses
        # data.group. Keep source fields intact and reuse the upstream parser.
        normalized = {'data': {'node': {**group, '__typename': 'Group'}}}
        return parse_page(json.dumps(normalized), group_id, allow_partial=True)

    def close(self):
        try:
            updated = merged_state(self.state, self.context.session.cookies)
            if {'c_user', 'xs'}.issubset({c['name'] for c in updated['cookies']}):
                self.accounts.save(self.aid, updated)
            else:
                # Preserve a server-issued expiry/deletion, not a stale usable copy.
                atomic_json(self.accounts.path(self.aid), updated)
                if self.accounts.get(self.aid)['status'] != 'restricted':
                    self.accounts.record_error(self.aid, CollectorError('authentication_required', 'Saved authentication expired.'))
        finally:
            self.context.session.close()
