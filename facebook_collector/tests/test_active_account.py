import tempfile
import unittest
from unittest.mock import Mock

from ..accounts.manager import Accounts
from ..app import App
from ..errors import CollectorError
from ..groups.manager import Groups
from ..storage.database import Database
from .test_accounts import state


class ActiveAccountTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Database(self.temp.name)
        self.accounts = Accounts(self.db)
        self.a = self.accounts.add('Shared user A')['id']
        self.b = self.accounts.add('Shared user B')['id']
        for aid in (self.a, self.b):
            self.accounts.save(aid, state())
            self.db.execute("UPDATE accounts SET status='saved_unverified' WHERE id=?",(aid,))
        self.groups = Groups(self.db)
        self.groups.add('123',account=self.a,basis='Offline test')
        self.groups.authorise('123',self.b,'Independent offline test')

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def test_precedence_explicit_active_then_group_preference(self):
        group = self.groups.get('123')
        self.assertEqual(self.groups.select_account(group),self.a)
        self.accounts.use(self.b)
        self.assertEqual(self.groups.select_account(group),self.b)
        self.assertEqual(self.groups.select_account(group,self.a),self.a)
        self.accounts.clear_active()
        self.assertEqual(self.groups.select_account(group),self.a)

    def test_active_selection_survives_reopen(self):
        self.accounts.use(self.b)
        other = Database(self.temp.name)
        try:
            self.assertEqual(Accounts(other).active()['id'],self.b)
        finally:
            other.close()

    def test_deleting_selected_session_clears_active_only(self):
        self.accounts.use(self.b)
        self.accounts.delete_session(self.b)
        self.assertIsNone(self.accounts.active())
        self.assertTrue(self.accounts.path(self.a).exists())
        self.assertEqual(self.groups.get('123')['preferred_account'],self.a)

    def test_other_users_access_is_not_inherited(self):
        self.groups.add('456',account=self.a,basis='User A only')
        self.accounts.use(self.b)
        with self.assertRaises(CollectorError) as error:
            self.groups.select_account(self.groups.get('456'))
        self.assertEqual(error.exception.code,'permission_required')

    def test_public_group_needs_no_manual_access_record(self):
        self.groups.add('789',visibility='public')
        self.accounts.use(self.b)
        self.assertEqual(self.groups.select_account(self.groups.get('789')),self.b)
        access = self.db.one('SELECT * FROM group_access WHERE group_id=? AND account_id=?',('789',self.b))
        self.assertEqual(access['access_basis'],'')
        self.assertEqual(access['status'],'untested')
        # Automatic tracking is not a declaration that Facebook granted access.
        self.assertEqual(self.groups.select_account(self.groups.get('789')),self.b)

    def test_public_group_tracking_does_not_clear_actual_access_failure(self):
        self.groups.add('789',visibility='public')
        self.accounts.use(self.b)
        self.groups.select_account(self.groups.get('789'))
        self.db.execute("UPDATE group_access SET status='access_denied' WHERE group_id='789'")
        with self.assertRaises(CollectorError) as error:
            self.groups.select_account(self.groups.get('789'))
        self.assertEqual(error.exception.code,'access_denied')
        self.assertEqual(error.exception.details['restriction_scope'],'account_group')

    def test_account_failure_does_not_globally_block_other_authorised_researchers(self):
        self.db.execute("UPDATE groups SET access_status='restricted' WHERE id='123'")
        self.db.execute("UPDATE accounts SET status='restricted' WHERE id=?",(self.a,))
        self.db.execute("UPDATE group_access SET status='restricted',last_checked_at='2026-11-04T10:00:00+00:00' WHERE account_id=?",(self.a,))
        self.accounts.use(self.b)
        group = self.groups.get('123')
        self.assertEqual(self.groups.select_account(group),self.b)
        self.assertEqual(self.groups.select_account(group,self.b),self.b)
        backend = Mock()
        with self.assertRaises(CollectorError) as error:
            App(self.db,backend).inspect('123',self.a)
        self.assertEqual(error.exception.details['restriction_scope'],'account')
        self.assertFalse(error.exception.details['facebook_request_made'])
        backend.assert_not_called()

    def test_account_group_denial_does_not_automatically_switch_accounts(self):
        self.db.execute("UPDATE group_access SET status='access_denied' WHERE account_id=?",(self.b,))
        self.accounts.use(self.b)
        with self.assertRaises(CollectorError) as error:
            self.groups.select_account(self.groups.get('123'))
        self.assertEqual(error.exception.details['restriction_scope'],'account_group')
        self.assertEqual(self.accounts.active()['id'],self.b)
        self.groups.authorise('123',self.b,'Updated documentation does not clear a denial')
        self.assertEqual(self.db.one('SELECT status FROM group_access WHERE account_id=?',(self.b,))['status'],'access_denied')

    def test_posts_and_checkpoint_are_shared_across_researchers(self):
        from .test_checkpoint import FakeCollector, post
        from ..collectors.base import Page
        app = App(self.db,lambda *args:FakeCollector([Page([post()],False,None)]))
        self.accounts.use(self.a)
        first = app.scan('123')
        before = self.db.one("SELECT coverage_end FROM checkpoints WHERE group_id='123'")
        self.accounts.use(self.b)
        second = app.scan('123')
        self.assertEqual((first['new_posts'],second['new_posts'],second['duplicates']),(1,0,1))
        self.assertIsNotNone(before['coverage_end'])
        self.assertEqual(len(self.db.rows('SELECT * FROM posts')),1)
        self.assertEqual(len(self.db.rows('SELECT * FROM checkpoints')),1)
        row = self.db.one('SELECT * FROM posts')
        self.assertEqual(row['first_scan_id'],first['run_id'])
        self.assertEqual(row['last_scan_id'],second['run_id'])

    def test_session_recovery_does_not_clear_membership_denial(self):
        self.db.execute("UPDATE accounts SET status='authenticated',last_checked_at='2026-11-04T11:00:00+00:00' WHERE id=?",(self.a,))
        self.db.execute("UPDATE group_access SET status='restricted',last_checked_at='2026-11-04T10:00:00+00:00' WHERE account_id=?",(self.a,))
        self.assertEqual(self.groups.select_account(self.groups.get('123'),self.a),self.a)
        self.db.execute("UPDATE group_access SET status='membership_required' WHERE account_id=?",(self.a,))
        with self.assertRaises(CollectorError):
            self.groups.select_account(self.groups.get('123'),self.a)

    def test_restricted_account_cannot_be_activated(self):
        self.db.execute("UPDATE accounts SET status='restricted' WHERE id=?",(self.b,))
        with self.assertRaises(CollectorError):
            self.accounts.use(self.b)
        self.assertIsNone(self.accounts.active())
