"""Read Facebook's JSON bootstrap without evaluating page JavaScript.

Only the requested group's metadata and its own discussion query are retained.
"""
from html.parser import HTMLParser
import json

from ..errors import fail


class JSONScripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.documents, self.active, self.buffer = [], False, []

    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            self.active = dict(attrs).get('type') == 'application/json'
            self.buffer = []

    def handle_data(self, data):
        if self.active:
            self.buffer.append(data)

    def handle_endtag(self, tag):
        if tag == 'script' and self.active:
            try:
                self.documents.append(json.loads(''.join(self.buffer)))
            except ValueError:
                pass  # Unrelated page scripts do not establish group metadata.
            self.active = False


def read_bootstrap(html, gid):
    scripts = JSONScripts()
    scripts.feed(html)
    stack = list(scripts.documents)
    name, privacy, token, discussion = None, None, None, None
    while stack:
        value = stack.pop()
        if isinstance(value, dict):
            if str(value.get('id')) == gid:
                name = value.get('name') or name
                info = value.get('privacy_info') or {}
                if isinstance(info, dict):
                    title = info.get('title') or info.get('label') or {}
                    privacy = (title.get('text') if isinstance(title, dict) else None) or privacy
            if value.get('queryName') == 'CometGroupDiscussionRootSuccessQuery':
                variables = value.get('variables')
                qid = str(value.get('queryID', ''))
                if isinstance(variables, dict) and str(variables.get('groupID')) == gid and qid.isdigit():
                    discussion = {'id': qid, 'variables': variables}
            stack.extend(value.values())
        elif isinstance(value, list):
            if value and value[0] == 'DTSGInitialData':
                for item in value[1:]:
                    if isinstance(item, dict) and isinstance(item.get('token'), str):
                        token = item['token']
            stack.extend(value)
    if not isinstance(name, str) or not name.strip():
        fail('metadata_unavailable', 'The page did not contain a verifiable header for this group.')
    return {'group_id': gid, 'name': name, 'url': 'https://www.facebook.com/groups/' + gid,
            'privacy': privacy, 'discussion': discussion, 'token': token}
