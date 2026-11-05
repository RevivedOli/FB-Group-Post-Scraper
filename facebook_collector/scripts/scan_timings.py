"""Read-only, bounded scan timing summaries. No posts, accounts or cookies."""
import json
from pathlib import Path
import sqlite3
import sys

path = Path(sys.argv[1]).resolve()
if not path.is_file():
    print('[]')
else:
    with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=5) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute('''SELECT group_id,started_at,finished_at,pages,posts_fetched
            FROM scan_runs WHERE scan_completed=1 AND pages>0 AND finished_at IS NOT NULL
            ORDER BY started_at DESC LIMIT 200''')
        print(json.dumps([dict(row) for row in rows]))
