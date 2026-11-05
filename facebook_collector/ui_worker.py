"""One bounded sequential collector cycle, callable from CLI or the local UI.

JSON input is configuration, never code. Output contains summaries, never post text.
"""
from functools import partial
import json
import math
import random
import sys
import time
from pathlib import Path
from .accounts.manager import Accounts
from .app import App
from .collectors.facebook_gql import FacebookGQL
from .errors import CollectorError
from .groups.manager import Groups, group_id
from .storage.database import Database


def emit(value):
    print(json.dumps(value), flush=True)


def cycle(db, spec, factory=None, output=emit, pause=time.sleep):
    groups = spec.get('groups')
    if spec.get('mode') not in ('test', 'run') or not isinstance(groups, list) or not 1 <= len(groups) <= 100:
        raise ValueError('Invalid cycle')
    age = float(spec.get('max_age_hours', 7))
    pages, limit = int(spec.get('max_pages', 5)), int(spec.get('limit', 50))
    if not 0 < age <= 8760 or not 1 <= pages <= 20 or not 1 <= limit <= 500:
        raise ValueError('Invalid cycle limits')
    pacing=spec.get('pacing') or {}
    def bounds(prefix, default_min, default_max, ceiling):
        low=float(pacing.get(prefix+'MinSeconds',default_min));high=float(pacing.get(prefix+'MaxSeconds',default_max))
        if not math.isfinite(low) or not math.isfinite(high) or not 2<=low<=high<=ceiling:
            raise ValueError('Invalid timing range')
        return low,high
    request_min,request_max=bounds('request',5,10,120)
    page_min,page_max=bounds('page',10,20,300)
    group_min,group_max=bounds('group',10,30,600)
    deadline=float(pacing.get('groupDeadlineSeconds',180))
    if not math.isfinite(deadline) or not 30<=deadline<=600:raise ValueError('Invalid time budget')
    groups=list(groups)
    if pacing.get('shuffleGroups',True):random.shuffle(groups)
    account = spec.get('account') or (Accounts(db).active() or {}).get('id')
    if not account:
        raise CollectorError('authentication_required', 'Select a saved collector account with account login/use before running groups.')
    # One shared-machine cycle at a time, including cycles launched outside the UI.
    with db.lock('ui-worker'):
        app = App(db, factory or partial(FacebookGQL, delay=request_min, delay_max=request_max, page_delay=page_min, page_delay_max=page_max, max_requests=30, deadline=deadline))
        output({'type':'started', 'account_id':account, 'facebook_profile_id':Accounts(db).get(account)['profile_id']})
        for index, item in enumerate(groups):
            if index:
                pause(random.uniform(group_min,group_max))
            identity = {'ui_id':item['ui_id'], 'name':item['name']}
            output({'type':'group_started', **identity})
            try:
                gid = group_id(item['reference'])
                existing = db.one('SELECT id FROM groups WHERE id=?', (gid,))
                if not existing:
                    # Unknown visibility stays unknown; actual access is verified, not inferred.
                    Groups(db).add(gid, name=item['name'], account=account,
                                   basis='Selected by the operator from the shared local research group list.')
                if spec['mode'] == 'test':
                    result = app.inspect(gid, account)
                    status = 'accessible' if result.get('feed_access') == 'verified_posts' else 'feed_unverified'
                else:
                    result = app.scan(gid, account, limit=limit, max_pages=pages, max_age_hours=age)
                    result.pop('new_records', None)
                    status = 'collected'
                output({'type':'group_result', **identity, 'group_id':gid, 'status':status, 'result':result})
            except CollectorError as error:
                output({'type':'group_result', **identity, 'status':error.code, 'message':str(error)})
                if error.code == 'interrupted':
                    output({'type':'stopped', 'reason':'cancelled'})
                    return
                if error.code in ('restricted','authentication_required','authentication_unverified'):
                    output({'type':'stopped', 'reason':error.code})
                    return
        output({'type':'completed'})


def main():
    db = None
    try:
        spec = json.load(sys.stdin)
        directory = spec.get('data_dir') or str(Path(__file__).parent / 'data')
        db = Database(directory)
        cycle(db, spec)
        return 0
    except KeyboardInterrupt:
        emit({'type':'stopped','reason':'cancelled'})
        return 130
    except CollectorError as error:
        emit({'type':'stopped','reason':error.code,'message':str(error)})
        return 1
    except Exception:
        emit({'type':'stopped','reason':'worker_error','message':'Collector cycle failed; check local configuration and saved account.'})
        return 1
    finally:
        if db:
            db.close()


if __name__ == '__main__':
    sys.exit(main())
