"""Read-only, bounded bridge to the existing UI. Never reads account/session tables."""
import json
from pathlib import Path
import sqlite3
import sys


def snapshot(database, cursor=None, limit=200):
    path = Path(database).resolve()
    if not path.is_file():
        return {'connected': False, 'posts': [], 'groups': [], 'total_posts': 0}
    with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=5) as conn:
        conn.row_factory = sqlite3.Row
        conn.create_function('has_text', 1, lambda text: isinstance(text, str) and bool(text.strip()))
        conn.execute('PRAGMA query_only=ON')
        conn.execute('BEGIN')
        groups = [dict(row) for row in conn.execute('SELECT id,url,name,enabled,next_due_at,last_attempted_at,last_successful_at,access_status FROM groups ORDER BY id')]
        values = cursor or ['', '', '']
        posts = [dict(row) for row in conn.execute('''SELECT group_id,post_id,post_url,text,published_at,first_observed_at,last_observed_at,revision
            FROM posts WHERE has_text(text)
            AND (last_observed_at,group_id,post_id) > (?,?,?)
            ORDER BY last_observed_at,group_id,post_id LIMIT ?''', (*values, limit))]
        total = conn.execute("SELECT count(*) FROM posts WHERE has_text(text)").fetchone()[0]
        return {'connected': True, 'posts': posts, 'groups': groups, 'total_posts': total}


if __name__ == '__main__':
    print(json.dumps(snapshot(sys.argv[1], json.loads(sys.argv[2]) if len(sys.argv) > 2 else None)))
