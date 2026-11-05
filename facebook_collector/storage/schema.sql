PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS accounts (
 id TEXT PRIMARY KEY, label TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'not_authenticated',
 profile_id TEXT, last_authenticated_at TEXT, last_checked_at TEXT, last_error TEXT
);
CREATE TABLE IF NOT EXISTS groups (
 id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, name TEXT, visibility TEXT NOT NULL DEFAULT 'unknown'
 CHECK(visibility IN ('public','private','unknown')), enabled INTEGER NOT NULL DEFAULT 1,
 preferred_account TEXT REFERENCES accounts(id) ON DELETE SET NULL,
 interval_seconds INTEGER NOT NULL DEFAULT 10800 CHECK(interval_seconds > 0),
 next_due_at TEXT, last_attempted_at TEXT, last_successful_at TEXT, last_observed_post TEXT,
 access_status TEXT NOT NULL DEFAULT 'untested'
);
CREATE TABLE IF NOT EXISTS group_access (
 group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 access_basis TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'untested', last_checked_at TEXT,
 PRIMARY KEY(group_id,account_id)
);
CREATE TABLE IF NOT EXISTS scan_runs (
 id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id),
 account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
 started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL DEFAULT 'running',
 posts_fetched INTEGER NOT NULL DEFAULT 0, new_posts INTEGER NOT NULL DEFAULT 0,
 duplicates INTEGER NOT NULL DEFAULT 0, pages INTEGER NOT NULL DEFAULT 0,
 scan_completed INTEGER NOT NULL DEFAULT 0, coverage_complete INTEGER NOT NULL DEFAULT 0,
 chronological_verified INTEGER NOT NULL DEFAULT 0, reached_overlap INTEGER NOT NULL DEFAULT 0,
 stop_reason TEXT, error_code TEXT, error_message TEXT, filter_details TEXT
);
CREATE TABLE IF NOT EXISTS posts (
 group_id TEXT NOT NULL REFERENCES groups(id), post_id TEXT NOT NULL, post_url TEXT, text TEXT,
 published_at TEXT, first_observed_at TEXT NOT NULL, last_observed_at TEXT NOT NULL,
 collector TEXT NOT NULL, account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
 first_scan_id TEXT NOT NULL REFERENCES scan_runs(id), last_scan_id TEXT NOT NULL REFERENCES scan_runs(id),
 revision INTEGER NOT NULL DEFAULT 1, exported_at TEXT,
 PRIMARY KEY(group_id,post_id)
);
CREATE TABLE IF NOT EXISTS checkpoints (
 group_id TEXT PRIMARY KEY REFERENCES groups(id), last_successful_scan TEXT,
 coverage_end TEXT, latest_publication TEXT, last_post_id TEXT,
 recently_seen_ids TEXT NOT NULL DEFAULT '[]', chronological_verified INTEGER NOT NULL DEFAULT 0,
 last_scan_completed INTEGER NOT NULL DEFAULT 0, last_run_id TEXT REFERENCES scan_runs(id)
);
CREATE INDEX IF NOT EXISTS groups_due ON groups(enabled,next_due_at);
CREATE INDEX IF NOT EXISTS posts_unexported ON posts(exported_at,first_observed_at);
CREATE INDEX IF NOT EXISTS scans_group ON scan_runs(group_id,started_at);
CREATE TABLE IF NOT EXISTS skipped_posts (
 group_id TEXT NOT NULL REFERENCES groups(id), post_id TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(reason='no_text'),
 first_observed_at TEXT NOT NULL, last_observed_at TEXT NOT NULL,
 last_scan_id TEXT NOT NULL REFERENCES scan_runs(id),
 PRIMARY KEY(group_id,post_id)
);
CREATE TABLE IF NOT EXISTS local_preferences (
 id INTEGER PRIMARY KEY CHECK(id=1),
 active_account TEXT REFERENCES accounts(id) ON DELETE SET NULL
);
