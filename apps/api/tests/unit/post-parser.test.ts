import { describe, expect, it } from 'vitest';
import { extractFacebookPostId, normalizeFacebookPostUrl, parsePostCandidate, parseRelativeTimestamp } from '../../src/services/post-parser.js';

describe('post parser', () => {
  it('normalizes group post URLs and extracts post IDs', () => {
    const url = normalizeFacebookPostUrl('https://m.facebook.com/groups/123/permalink/456/?comment_id=999');
    expect(url).toBe('https://www.facebook.com/groups/123/posts/456');
    expect(extractFacebookPostId(url)).toBe('456');
  });

  it('normalizes permalink.php URLs with story IDs', () => {
    const url = normalizeFacebookPostUrl('https://www.facebook.com/permalink.php?story_fbid=456&id=123&tracking=abc');
    expect(url).toBe('https://www.facebook.com/groups/123/posts/456');
  });

  it('normalizes group multi-permalink URLs', () => {
    const url = normalizeFacebookPostUrl('https://www.facebook.com/groups/123?multi_permalinks=456&ref=share');
    expect(url).toBe('https://www.facebook.com/groups/123/posts/456');
  });

  it('uses group context for story links without a group id', () => {
    const parsed = parsePostCandidate({
      text: 'A visible post with a story link and enough text.',
      links: ['https://www.facebook.com/story.php?story_fbid=456'],
      imageCount: 0,
      canonicalGroupUrl: 'https://www.facebook.com/groups/123',
    });

    expect(parsed.canonicalPostUrl).toBe('https://www.facebook.com/groups/123/posts/456');
  });

  it('parses relative timestamp labels', () => {
    const now = new Date('2026-08-04T12:00:00.000Z');
    expect(parseRelativeTimestamp('2 h', now)?.toISOString()).toBe('2026-08-04T10:00:00.000Z');
    expect(parseRelativeTimestamp('yesterday', now)?.toISOString()).toBe('2026-08-03T12:00:00.000Z');
  });

  it('marks missing parser fields with warnings', () => {
    const parsed = parsePostCandidate({ text: 'This is a useful business post with enough text.', links: [], imageCount: 0 });
    expect(parsed.fieldWarnings).toContain('missing_permalink');
    expect(parsed.fieldWarnings).toContain('missing_author');
    expect(parsed.extractionConfidence).toBe(0.45);
  });
});
