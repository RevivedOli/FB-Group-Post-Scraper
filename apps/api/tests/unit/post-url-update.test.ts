import { describe, expect, it } from 'vitest';
import { extractFacebookPostId, normalizeFacebookPostUrl } from '../../src/services/post-parser.js';
import { isRealFacebookPostPermalink } from '@local-group-monitor/shared';

describe('manual permalink correction helpers', () => {
  it('normalizes mobile and permalink-style Facebook post URLs', () => {
    expect(normalizeFacebookPostUrl('https://m.facebook.com/groups/983908805062935/permalink/4531673237045067/'))
      .toBe('https://www.facebook.com/groups/983908805062935/posts/4531673237045067');
    expect(normalizeFacebookPostUrl('https://www.facebook.com/groups/983908805062935/posts/4531673237045067/?ref=share'))
      .toBe('https://www.facebook.com/groups/983908805062935/posts/4531673237045067');
  });

  it('extracts facebook post ids from normalized permalinks', () => {
    expect(extractFacebookPostId('https://www.facebook.com/groups/abc/posts/1234567890')).toBe('1234567890');
  });

  it('rejects hash fallback and group-only URLs as real permalinks', () => {
    expect(isRealFacebookPostPermalink('https://www.facebook.com/groups/abc#post-deadbeef')).toBe(false);
    expect(isRealFacebookPostPermalink('https://www.facebook.com/groups/abc')).toBe(false);
    expect(isRealFacebookPostPermalink('https://www.facebook.com/groups/abc/posts/123')).toBe(true);
  });
});
