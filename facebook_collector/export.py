"""Durable pending export + explicit consumer acknowledgement, no AI calls."""
import json
import os
from pathlib import Path
import tempfile
from .errors import fail
from .storage.database import now


def event_id(post):
    return 'facebook:' + post['group_id'] + ':' + post['post_id']


def legacy_candidate(post):
    """Matches saveExtractedPosts(groupId, ExtractedPostCandidate[]) fields.

    Consumer must resolve Facebook group ID to its own Prisma Group.id.
    """
    if not post['post_url']:
        fail('export_incomplete', 'Legacy export requires a real source permalink; record remains pending.')
    return {
        'event_id': event_id(post), 'facebookGroupId': post['group_id'],
        'media_collected': False,
        'candidate': {
            'facebookPostId': post['post_id'], 'canonicalPostUrl': post['post_url'],
            'text': post['text'], 'originalPostedAt': post['published_at'],
            'authorName': None, 'timestampLabel': None, 'hasImages': False, 'imageCount': 0,
            # Required numeric legacy field: zero is a conservative unscored sentinel.
            'extractionStrategy': 'facebook_gql', 'extractionConfidence': 0,
            'fieldWarnings': ['media_not_collected', 'confidence_not_scored'],
        },
    }


class Exporter:
    def __init__(self, db):
        self.db = db

    def get_unprocessed_posts(self):
        return self.db.rows('SELECT * FROM posts WHERE exported_at IS NULL AND has_text(text) ORDER BY first_observed_at,group_id,post_id')

    def mark_post_exported(self, post_id, group_id):
        # Composite key is mandatory; post IDs alone need not be globally unique.
        if not self.db.one('SELECT post_id FROM posts WHERE group_id=? AND post_id=?', (group_id, post_id)):
            fail('unknown_post', 'This group/post has not been collected; no acknowledgement was recorded.')
        self.db.execute('UPDATE posts SET exported_at=COALESCE(exported_at,?) WHERE group_id=? AND post_id=?',
                        (now(), group_id, post_id))

    def export_new_posts(self, destination, legacy=False):
        path = Path(destination).expanduser().resolve()
        if path.exists():
            fail('export_exists', 'Choose a new export filename; existing files are not overwritten.')
        path.parent.mkdir(parents=True, exist_ok=True)
        pending = self.get_unprocessed_posts()
        posts = [post for post in pending if post['post_url']] if legacy else pending
        fd, temp = tempfile.mkstemp(prefix='.export-', dir=path.parent)
        try:
            with os.fdopen(fd, 'w') as f:
                os.fchmod(f.fileno(), 0o600)
                for post in posts:
                    item = legacy_candidate(post) if legacy else {**post, 'event_id': event_id(post)}
                    f.write(json.dumps(item, ensure_ascii=False) + '\n')
                f.flush()
                os.fsync(f.fileno())
            os.link(temp, path)  # Atomic no-overwrite publication on local filesystem.
        finally:
            os.unlink(temp)
        # Never acknowledge on file creation; consumer success is independent.
        return {'path': str(path), 'records': len(posts), 'deferred': len(pending) - len(posts), 'acknowledged': False}
