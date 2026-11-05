const REAL_PERMALINK_RE = /^https:\/\/www\.facebook\.com\/groups\/[^/#?]+\/posts\/\d+/;
const HASH_FALLBACK_RE = /#post-[0-9a-f]+$/i;
const MAX_EXCERPT_CHARS = 100;
const MAX_EXCERPT_WORDS = 12;

export function isRealFacebookPostPermalink(url?: string | null) {
  return Boolean(url && REAL_PERMALINK_RE.test(url));
}

export function isHashFallbackPostUrl(url?: string | null) {
  return Boolean(url && HASH_FALLBACK_RE.test(url));
}

/** First N meaningful words, normalized and capped for Facebook group search. */
export function buildPostSearchExcerpt(text?: string | null, maxWords = MAX_EXCERPT_WORDS, maxChars = MAX_EXCERPT_CHARS) {
  const normalized = (text ?? '')
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';

  const words = normalized.split(' ').filter(Boolean).slice(0, Math.max(1, maxWords));
  let excerpt = words.join(' ');
  if (excerpt.length > maxChars) {
    excerpt = excerpt.slice(0, maxChars).replace(/\s+\S*$/, '').trim();
  }
  return excerpt;
}

export function extractFacebookGroupPath(groupUrl?: string | null) {
  if (!groupUrl) return undefined;
  try {
    const url = new URL(groupUrl.includes('://') ? groupUrl : `https://${groupUrl}`);
    if (!['facebook.com', 'www.facebook.com', 'm.facebook.com'].includes(url.hostname.toLowerCase())) {
      return undefined;
    }
    const match = url.pathname.match(/\/groups\/([^/#?]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

export function buildFacebookGroupSearchUrl(groupUrl: string | null | undefined, excerpt: string) {
  const groupSlug = extractFacebookGroupPath(groupUrl);
  const query = excerpt.trim();
  if (!groupSlug || !query) return null;
  return `https://www.facebook.com/groups/${encodeURIComponent(groupSlug)}/search/?q=${encodeURIComponent(query)}`;
}

export function resolvePostOpenUrl(input: {
  canonicalPostUrl?: string | null;
  latestCapturedText?: string | null;
  groupCanonicalUrl?: string | null;
}) {
  const canonical = input.canonicalPostUrl ?? '';
  if (isRealFacebookPostPermalink(canonical)) {
    return {
      hasRealPermalink: true as const,
      searchPostUrl: null,
      openPostUrl: canonical,
      searchExcerpt: '',
    };
  }

  const groupUrl = input.groupCanonicalUrl
    ?? (canonical.includes('#post-') ? canonical.split('#')[0] : canonical);
  const searchExcerpt = buildPostSearchExcerpt(input.latestCapturedText);
  const searchPostUrl = buildFacebookGroupSearchUrl(groupUrl, searchExcerpt);
  return {
    hasRealPermalink: false as const,
    searchPostUrl,
    openPostUrl: searchPostUrl ?? canonical,
    searchExcerpt,
  };
}

export function withPostLinkFields<T extends {
  canonicalPostUrl?: string | null;
  latestCapturedText?: string | null;
  group?: { canonicalGroupUrl?: string | null } | null;
}>(post: T) {
  const links = resolvePostOpenUrl({
    canonicalPostUrl: post.canonicalPostUrl,
    latestCapturedText: post.latestCapturedText,
    groupCanonicalUrl: post.group?.canonicalGroupUrl,
  });
  return {
    ...post,
    hasRealPermalink: links.hasRealPermalink,
    searchPostUrl: links.searchPostUrl,
    openPostUrl: links.openPostUrl,
    searchExcerpt: links.searchExcerpt || null,
  };
}
