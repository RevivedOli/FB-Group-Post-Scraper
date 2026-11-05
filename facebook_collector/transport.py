"""Conservative authenticated HTTP transport shared by account checks and SDK."""
import json
import re
import time
import random
from urllib.parse import urlsplit, urljoin
import requests

from .errors import CollectorError, fail


def facebook_url(url):
    parsed = urlsplit(url)
    host = parsed.hostname or ''
    return (parsed.scheme == 'https' and parsed.port in (None, 443)
            and not parsed.username and not parsed.password
            and (host == 'facebook.com' or host.endswith('.facebook.com')
                 or host == 'fbcdn.net' or host.endswith('.fbcdn.net')))


def check_response(response):
    """Classify control signals, never matching restriction words inside post text."""
    path = urlsplit(response.url).path.lower()
    if any(p in path for p in ('/checkpoint', '/challenge', '/two_step_verification')):
        fail('restricted', 'Facebook requires an operator security check; this account is suspended.')
    if response.status_code in (403, 429):
        fail('restricted', 'Facebook refused or rate-limited access; this account is suspended.')
    if response.status_code == 401 or '/login' in path:
        fail('authentication_required', 'Facebook requires a new interactive login.')
    text = response.text
    if 'html' in response.headers.get('content-type', '') or text.lstrip().startswith(('<!DOCTYPE', '<html')):
        if re.search(r'<(?:title|h1|h2)[^>]*>\s*(?:You(?:&#039;|’|\')re\s+)?(?:temporarily blocked|account (?:suspended|disabled)|security check|checkpoint)', text, re.I):
            fail('restricted', 'Facebook displayed an account restriction/security check; this account is suspended.')
        if re.search(r'<input[^>]+(?:name|id)=[\"\'](?:pass|email)[\"\']', text, re.I):
            fail('authentication_required', 'Facebook returned a login form.')
        return
    cleaned = text.removeprefix('for (;;);')
    for line in cleaned.splitlines():
        try:
            payload = json.loads(line)
        except (ValueError, TypeError):
            continue
        if not isinstance(payload, dict):
            continue
        errors = payload.get('errors') or []
        if payload.get('error'):
            errors = list(errors) + [payload]
        for error in errors:
            if not isinstance(error, dict):
                continue
            message = ' '.join(str(error.get(k, '')) for k in ('message', 'summary', 'errorSummary', 'description')).lower()
            code = error.get('code', error.get('error'))
            if code in (190, 102) or 'log in' in message or 'session expired' in message:
                fail('authentication_required', 'Facebook rejected the saved authentication.')
            if code in (4, 17, 368, 613, 1675004) or any(x in message for x in ('checkpoint', 'temporarily blocked', 'rate limit', 'restricted')):
                fail('restricted', 'Facebook returned a restriction; collection has been suspended.')
            if 'permission' in message or 'not authorized' in message:
                fail('access_denied', 'The account is not authorised for this feed.')
            # Leave only explicitly supported SDK token/doc-id recovery to the SDK.
            if 'document with id' not in message and 'sorry, something went wrong' not in message:
                fail('parser_error', 'Facebook returned an unrecognised GraphQL error; no coverage checkpoint was advanced.')


class GuardedSession(requests.Session):
    def __init__(self, max_requests=100, delay=2.0, deadline_seconds=180, retries=2, delay_max=None):
        super().__init__()
        self.trust_env = False  # no implicit proxies, .netrc credentials or TLS overrides
        self.max_requests = max_requests
        self.delay = delay
        self.delay_max = delay if delay_max is None else delay_max
        self.deadline = time.monotonic() + deadline_seconds
        self.retries = retries
        self.count = 0
        self.last_request = 0.0
        self.terminal_error = None

    def request(self, method, url, **kwargs):
        if self.terminal_error:
            raise self.terminal_error
        try:
            return self._guarded_request(method, url, **kwargs)
        except CollectorError as error:
            # Upstream discovery catches broad exceptions. Latch failures so it
            # cannot keep making requests or turn a restriction into a parse error.
            self.terminal_error = error
            raise

    def _guarded_request(self, method, url, **kwargs):
        if method.upper() not in ('GET', 'POST') or not facebook_url(url):
            fail('unsafe_request', 'Only HTTPS Facebook/CDN read requests are permitted.')
        if method.upper() == 'POST' and urlsplit(url).path.rstrip('/') != '/api/graphql':
            fail('unsafe_request', 'Only the read-only GraphQL endpoint can receive POST requests.')
        if method.upper() == 'POST':
            payload = kwargs.get('data') or {}
            if not isinstance(payload, dict) or 'mutation' in str(payload.get('variables', '')).lower():
                fail('unsafe_request', 'Unexpected GraphQL request payload.')
        kwargs['verify'] = True
        kwargs['allow_redirects'] = False
        kwargs['stream'] = True
        redirect_count = 0
        attempts = 0
        while True:
            wait = max(0, self.last_request + random.uniform(self.delay, self.delay_max) - time.monotonic())
            if self.count >= self.max_requests or time.monotonic() + wait >= self.deadline:
                fail('request_budget', 'The scan reached its request/time budget; coverage is partial.')
            time.sleep(wait)
            self.count += 1
            self.last_request = time.monotonic()
            remaining = self.deadline - time.monotonic()
            kwargs['timeout'] = (min(10, remaining), min(30, remaining))
            response = None
            try:
                response = super().request(method, url, **kwargs)
                chunks, size = [], 0
                for chunk in response.iter_content(65536):
                    size += len(chunk)
                    if size > 12 * 1024 * 1024 or time.monotonic() > self.deadline:
                        fail('response_limit', 'Facebook response exceeded the configured size/time limit.')
                    chunks.append(chunk)
                response._content = b''.join(chunks)
                response._content_consumed = True
                if response.is_redirect:
                    redirect_count += 1
                    target = urljoin(url, response.headers.get('location', ''))
                    if redirect_count > 5 or not facebook_url(target):
                        fail('access_denied', 'Unexpected or excessive Facebook redirects.')
                    # Classify login/checkpoint redirects before another network request.
                    path = urlsplit(target).path.lower()
                    if '/checkpoint' in path or '/challenge' in path:
                        fail('restricted', 'Facebook requires a security check; this account is suspended.')
                    if '/login' in path:
                        fail('authentication_required', 'Facebook redirected to login.')
                    url = target
                    if response.status_code in (301, 302, 303):
                        method = 'GET'
                        kwargs.pop('data', None)
                    continue
                check_response(response)
                if response.status_code >= 500:
                    raise requests.ConnectionError()
                if response.status_code >= 400:
                    fail('unavailable', 'Facebook returned an unavailable resource.')
                return response
            except (requests.Timeout, requests.ConnectionError):
                if attempts >= self.retries:
                    fail('network_error', 'Network request failed after bounded retries.')
                attempts += 1
                time.sleep(min(2 ** attempts, 4))
            except requests.RequestException:
                fail('network_error', 'The HTTPS request failed; check local connectivity and TLS.')
            finally:
                if response is not None:
                    response.close()
