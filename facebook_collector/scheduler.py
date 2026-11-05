"""One process, sequential scans, SQLite due times, no account rotation."""
import time
from .app import App
from .errors import CollectorError
from .storage.database import now


def tick(db, app=None, scan_options=None):
    app = app or App(db)
    results = []
    for group in db.rows('SELECT * FROM groups WHERE enabled=1 AND (next_due_at IS NULL OR next_due_at<=?) ORDER BY COALESCE(next_due_at,\'\')', (now(),)):
        try:
            selected = app.groups.select_account(group)
        except CollectorError as error:
            results.append({'group_id': group['id'], 'skipped': error.code})
            continue
        account = db.one('SELECT * FROM accounts WHERE id=?', (selected,))
        if not account or account['status'] != 'authenticated':
            results.append({'group_id': group['id'], 'skipped': 'account_not_healthy'})
            continue
        # Do not enable autonomous live scans before a manual scan retrieves posts.
        previous = db.one('SELECT id FROM scan_runs WHERE group_id=? AND account_id=? AND scan_completed=1 AND posts_fetched>0 LIMIT 1',
                          (group['id'], account['id']))
        if not previous:
            results.append({'group_id': group['id'], 'skipped': 'manual_scan_required'})
            continue
        try:
            result = app.scan(group['id'], account['id'], **(scan_options or {}))
            result.pop('new_records', None)
            results.append(result)
        except CollectorError as error:
            results.append({'group_id': group['id'], 'error': error.code, 'message': str(error)})
    return results


def serve(db, app, scan_options=None, once=False, emit=print):
    with db.lock('scheduler'):
        while True:
            emit(tick(db, app, scan_options))
            if once:
                return
            time.sleep(30)
