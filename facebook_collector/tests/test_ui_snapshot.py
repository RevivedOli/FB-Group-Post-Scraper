import sqlite3
import tempfile
import unittest
from pathlib import Path
from ..scripts.ui_snapshot import snapshot


class SnapshotTests(unittest.TestCase):
    def test_missing_database_is_not_created(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'missing.db'
            self.assertFalse(snapshot(path)['connected'])
            self.assertFalse(path.exists())

    def test_bounded_incremental_snapshot_excludes_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'collector.db'
            with sqlite3.connect(path) as conn:
                conn.executescript('''CREATE TABLE groups(id,url,name,enabled,next_due_at,last_attempted_at,last_successful_at,access_status);
                INSERT INTO groups VALUES('123','https://www.facebook.com/groups/123','Example',1,NULL,NULL,NULL,'verified');
                CREATE TABLE accounts(secret); INSERT INTO accounts VALUES('never-export-cookie');
                CREATE TABLE posts(group_id,post_id,post_url,text,published_at,first_observed_at,last_observed_at,revision);
                INSERT INTO posts VALUES('123','1',NULL,'Looking for a plumber',NULL,'2026-11-04','2026-11-04',1);
                INSERT INTO posts VALUES('123','2',NULL,'Does anyone know a builder?',NULL,'2026-11-04','2026-11-04',1);''')
            first = snapshot(path, limit=1)
            self.assertEqual(first['posts'][0]['post_id'], '1')
            second = snapshot(path, ['2026-11-04','123','1'], limit=1)
            self.assertEqual(second['posts'][0]['post_id'], '2')
            self.assertNotIn('never-export-cookie', str(first))
            self.assertEqual(first['total_posts'], 2)
