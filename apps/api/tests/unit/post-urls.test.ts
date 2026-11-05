import { describe, expect, it } from 'vitest';
import {
  buildFacebookGroupSearchUrl,
  buildPostSearchExcerpt,
  isHashFallbackPostUrl,
  isRealFacebookPostPermalink,
  resolvePostOpenUrl,
} from '@local-group-monitor/shared';

describe('post URL helpers', () => {
  it('detects real permalinks and hash fallbacks', () => {
    expect(isRealFacebookPostPermalink('https://www.facebook.com/groups/abc/posts/1234567890')).toBe(true);
    expect(isRealFacebookPostPermalink('https://www.facebook.com/groups/abc#post-a1b2c3d4e5f67890')).toBe(false);
    expect(isHashFallbackPostUrl('https://www.facebook.com/groups/abc#post-a1b2c3d4e5f67890')).toBe(true);
    expect(isHashFallbackPostUrl('https://www.facebook.com/groups/abc/posts/123')).toBe(false);
  });

  it('builds a 12-word excerpt capped near 100 characters', () => {
    const text = "You can't buy happiness, but you can buy cake, and that's basically the same thing cupcakes buttercream fondant registered";
    const excerpt = buildPostSearchExcerpt(text);
    expect(excerpt.split(' ').length).toBeLessThanOrEqual(12);
    expect(excerpt.length).toBeLessThanOrEqual(100);
    expect(excerpt.startsWith("You can't buy happiness")).toBe(true);
  });

  it('builds a Facebook group search URL from a short excerpt', () => {
    const excerpt = "You can't buy happiness, but you can buy cake";
    const url = buildFacebookGroupSearchUrl(
      'https://www.facebook.com/groups/983908805062935',
      excerpt,
    );
    expect(url).toBe(
      `https://www.facebook.com/groups/983908805062935/search/?q=${encodeURIComponent(excerpt)}`,
    );
  });

  it('prefers search URL over hash fallback for openPostUrl', () => {
    const links = resolvePostOpenUrl({
      canonicalPostUrl: 'https://www.facebook.com/groups/983908805062935#post-b5c1074161b5b618',
      latestCapturedText: "You can't buy happiness, but you can buy cake, and that's basically the same thing",
      groupCanonicalUrl: 'https://www.facebook.com/groups/983908805062935',
    });
    expect(links.hasRealPermalink).toBe(false);
    expect(links.searchPostUrl).toContain('/search/?q=');
    expect(links.openPostUrl).toBe(links.searchPostUrl);
  });

  it('keeps real permalinks as the open URL', () => {
    const links = resolvePostOpenUrl({
      canonicalPostUrl: 'https://www.facebook.com/groups/abc/posts/123',
      latestCapturedText: 'Looking for a plumber',
    });
    expect(links.hasRealPermalink).toBe(true);
    expect(links.searchPostUrl).toBeNull();
    expect(links.openPostUrl).toBe('https://www.facebook.com/groups/abc/posts/123');
  });
});
