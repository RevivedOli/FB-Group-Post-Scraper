from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import fcntl
import json
import os
import sqlite3
import tempfile

from ..errors import fail


def now():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds')


def has_text(value):
    return isinstance(value, str) and bool(value.strip())


def private_dir(path):
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink():
        fail('unsafe_storage', 'Data directory must not be a symbolic link.')
    path.chmod(0o700)
    return path


def atomic_json(path, data):
    path = Path(path)
    private_dir(path.parent)
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix='.save-')
    try:
        with os.fdopen(fd, 'w') as f:
            os.fchmod(f.fileno(), 0o600)
            json.dump(data, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


class Database:
    def __init__(self, directory):
        self.directory = private_dir(Path(directory).resolve())
        path = self.directory / 'collector.db'
        if path.is_symlink():
            fail('unsafe_storage', 'Database must not be a symbolic link.')
        # Create privately before SQLite opens the file.
        fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(fd)
        path.chmod(0o600)
        self.conn = sqlite3.connect(path, timeout=10)
        self.conn.row_factory = sqlite3.Row
        self.conn.create_function('has_text', 1, has_text, deterministic=True)
        self.conn.execute('PRAGMA foreign_keys=ON')
        self.conn.execute('PRAGMA journal_mode=WAL')
        self.conn.executescript(Path(__file__).with_name('schema.sql').read_text())
        if 'filter_details' not in {row['name'] for row in self.conn.execute('PRAGMA table_info(scan_runs)')}:
            with self.conn:
                self.conn.execute('ALTER TABLE scan_runs ADD COLUMN filter_details TEXT')

    def close(self):
        self.conn.close()

    def rows(self, sql, args=()):
        return [dict(r) for r in self.conn.execute(sql, args)]

    def one(self, sql, args=()):
        row = self.conn.execute(sql, args).fetchone()
        return dict(row) if row else None

    def execute(self, sql, args=()):
        with self.conn:
            self.conn.execute(sql, args)

    @contextmanager
    def lock(self, key):
        # Local cross-process protection, including CLI versus scheduler.
        import hashlib
        name = hashlib.sha256(key.encode()).hexdigest() + '.lock'
        locks = private_dir(self.directory / 'locks')
        fd = os.open(locks / name, os.O_CREAT | os.O_RDWR, 0o600)
        with os.fdopen(fd, 'w') as f:
            try:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                fail('busy', 'This group/account is already in use by another collector process.')
            try:
                yield
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)
