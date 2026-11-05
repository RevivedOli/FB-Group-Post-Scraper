import re
import sqlite3
from urllib.parse import urlsplit
from ..errors import CollectorError, fail
from ..accounts.manager import Accounts
from ..storage.database import now


def group_id(value):
    if value.isdigit():
        return value
    url = urlsplit(value)
    if url.scheme != 'https' or url.hostname not in {'www.facebook.com', 'facebook.com', 'web.facebook.com'}:
        fail('invalid_group', 'Use a numeric group ID or an HTTPS Facebook group URL.')
    match = re.fullmatch(r'/groups/([A-Za-z0-9._-]+)/?', url.path)
    if not match or url.username or url.password or url.port:
        fail('invalid_group', 'Expected https://www.facebook.com/groups/<id-or-slug>.')
    if not match[1].isdigit():
        fail('numeric_id_required', 'This proof of concept requires the numeric group ID (slug resolution is not enabled).')
    return match[1]


class Groups:
    def __init__(self, db):
        self.db = db

    def add(self, reference, name=None, visibility='unknown', account=None, basis=None):
        gid = group_id(reference)
        if self.db.one('SELECT id FROM groups WHERE id=?', (gid,)):
            fail('group_exists', 'This group is already registered. Use group list to view its existing settings; nothing was changed.')
        if account and not self.db.one('SELECT id FROM accounts WHERE id=?', (account,)):
            fail('unknown_account', 'Register the account first.')
        if visibility == 'private' and (not account or not basis or not basis.strip()):
            fail('permission_required', 'Private groups require an account and a recorded access basis.')
        with self.db.conn:
            try:
                self.db.conn.execute('INSERT INTO groups(id,url,name,visibility,preferred_account) VALUES(?,?,?,?,?)',
                                     (gid, 'https://www.facebook.com/groups/' + gid, name, visibility, account))
            except sqlite3.IntegrityError:
                # Another local process may have registered it after the precheck.
                if self.db.one('SELECT id FROM groups WHERE id=?', (gid,)):
                    fail('group_exists', 'This group is already registered. Use group list to view its existing settings; nothing was changed.')
                raise
            if account and basis and basis.strip():
                self.db.conn.execute('INSERT INTO group_access(group_id,account_id,access_basis) VALUES(?,?,?)',
                                     (gid, account, basis.strip()))
        return self.get(gid)

    def get(self, reference):
        row = self.db.one('SELECT * FROM groups WHERE id=?', (group_id(reference),))
        if not row:
            fail('unknown_group', 'Register this group first with group add.')
        return row

    def authorise(self, reference, account, basis):
        group = self.get(reference)
        if not basis.strip():
            fail('permission_required', 'Record the genuine access and collection authorisation basis.')
        if not self.db.one('SELECT id FROM accounts WHERE id=?', (account,)):
            fail('unknown_account', 'Register the account first.')
        self.db.execute('''INSERT INTO group_access(group_id,account_id,access_basis) VALUES(?,?,?)
          ON CONFLICT(group_id,account_id) DO UPDATE SET access_basis=excluded.access_basis ''',
                        (group['id'], account, basis.strip()))

    def select_account(self, group, account=None):
        active = Accounts(self.db).active()
        selected = account or (active['id'] if active else None) or group['preferred_account']
        source = 'explicit_argument' if account else ('active_account' if active else 'group_preferred_account')
        if not selected:
            fail('authentication_required', 'This library requires a saved account; anonymous mode is not validated or enabled.')
        chosen = Accounts(self.db).get(selected)
        details = {'group': group['id'], 'account_id': selected,
                   'facebook_profile_id': chosen['profile_id'], 'account_selection': source,
                   'status_source': 'local_registry', 'facebook_request_made': False}
        # groups.access_status describes the most recent attempt, not every
        # researcher's entitlement. Never turn an account lock into a global ban.
        if chosen['status'] in ('restricted', 'authentication_required'):
            raise CollectorError(chosen['status'],
                'Collection is paused for the selected account by its saved local status.',
                {**details, 'restriction_scope': 'account', 'local_status': chosen['status']})
        access = self.db.one('SELECT * FROM group_access WHERE group_id=? AND account_id=?', (group['id'], selected))
        if not access and group['visibility'] == 'public':
            # Track actual access outcomes without inventing an authorisation
            # assertion or requiring per-account paperwork for public sources.
            self.db.execute('INSERT OR IGNORE INTO group_access(group_id,account_id,access_basis) VALUES(?,?,?)',
                            (group['id'], selected, ''))
            access = self.db.one('SELECT * FROM group_access WHERE group_id=? AND account_id=?', (group['id'], selected))
        if group['visibility'] != 'public' and (not access or not access['access_basis'].strip()):
            fail('permission_required', 'Record group access/collection authorisation with group authorise first.')
        if access['status'] in ('restricted', 'authentication_required', 'access_denied', 'membership_required'):
            # A later successful HTTP account check permits a manually selected
            # retry of authentication failures for this same account. It does not
            # establish membership or clear a source-specific permission denial.
            recovered = (access['status'] in ('restricted', 'authentication_required')
                         and chosen['status'] == 'authenticated'
                         and chosen['last_checked_at'] is not None
                         and access['last_checked_at'] is not None
                         and chosen['last_checked_at'] > access['last_checked_at'])
            if not recovered:
                raise CollectorError(access['status'],
                    'The selected account has a saved access failure for this group; its access needs review.',
                    {**details, 'restriction_scope': 'account_group', 'local_status': access['status']})
        return selected
