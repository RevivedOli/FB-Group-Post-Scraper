export interface RawPostCandidate {
  text?: string;
  links: string[];
  imageCount: number;
  timestampLabel?: string;
  authorName?: string;
  canonicalGroupUrl?: string;
}

export interface ParsedPostCandidate {
  canonicalPostUrl?: string;
  facebookPostId?: string;
  authorName?: string;
  text?: string;
  timestampLabel?: string;
  originalPostedAt?: Date;
  hasImages: boolean;
  imageCount: number;
  extractionStrategy: string;
  extractionConfidence: number;
  fieldWarnings: string[];
}

function cleanText(value?: string) {
  return value?.replace(/\s+/g, ' ').trim();
}

export function normalizeFacebookPostUrl(href: string) {
  const url = new URL(href, 'https://www.facebook.com');
  url.hash = '';
  url.hostname = 'www.facebook.com';

  const storyFbid = url.searchParams.get('story_fbid') ?? url.searchParams.get('multi_permalinks');
  const id = url.searchParams.get('id') ?? url.searchParams.get('group_id');
  const path = url.pathname.replace(/\/+$/, '');
  const groupRootMatch = path.match(/\/groups\/([^/]+)/);
  const groupId = id ?? groupRootMatch?.[1];

  if (storyFbid && groupId) return `https://www.facebook.com/groups/${groupId}/posts/${storyFbid}`;

  const groupPostMatch = path.match(/\/groups\/([^/]+)\/(?:posts|permalink)\/([^/]+)/);
  if (groupPostMatch) return `https://www.facebook.com/groups/${groupPostMatch[1]}/posts/${groupPostMatch[2]}`;

  const permalinkMatch = path.match(/\/permalink\.php/);
  if (permalinkMatch && storyFbid) return `https://www.facebook.com/permalink.php?story_fbid=${storyFbid}`;

  return undefined;
}

export function extractFacebookPostId(canonicalPostUrl?: string) {
  if (!canonicalPostUrl) return undefined;
  const pathMatch = canonicalPostUrl.match(/\/(?:posts|permalink)\/([^/?#]+)/);
  if (pathMatch?.[1]) return pathMatch[1];
  return new URL(canonicalPostUrl).searchParams.get('story_fbid') ?? undefined;
}

export function parseRelativeTimestamp(label?: string, now = new Date()) {
  const value = cleanText(label)?.toLowerCase();
  if (!value) return undefined;

  const relative = value.match(/(\d+)\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days|w|week|weeks|mo|month|months)\b/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    const multipliers: Record<string, number> = {
      m: 60_000, min: 60_000, minute: 60_000, minutes: 60_000,
      h: 3_600_000, hr: 3_600_000, hour: 3_600_000, hours: 3_600_000,
      d: 86_400_000, day: 86_400_000, days: 86_400_000,
      w: 604_800_000, week: 604_800_000, weeks: 604_800_000,
      mo: 2_592_000_000, month: 2_592_000_000, months: 2_592_000_000,
    };
    return new Date(now.getTime() - amount * multipliers[unit]);
  }

  if (value.includes('yesterday')) return new Date(now.getTime() - 86_400_000);
  if (value.includes('today')) return now;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed);
}

export function parsePostCandidate(raw: RawPostCandidate, now = new Date()): ParsedPostCandidate {
  const text = cleanText(raw.text)?.slice(0, 12000);
  const candidateLinks = raw.links
    .map((link) => normalizeFacebookPostUrl(link) ?? normalizeViaGroupContext(link, raw.canonicalGroupUrl))
    .filter((url): url is string => Boolean(url));
  const canonicalPostUrl = candidateLinks[0];
  const fieldWarnings: string[] = [];

  if (!canonicalPostUrl) fieldWarnings.push('missing_permalink');
  if (!raw.authorName) fieldWarnings.push('missing_author');
  if (!raw.timestampLabel) fieldWarnings.push('missing_timestamp');

  return {
    canonicalPostUrl,
    facebookPostId: extractFacebookPostId(canonicalPostUrl),
    authorName: cleanText(raw.authorName),
    text,
    timestampLabel: cleanText(raw.timestampLabel),
    originalPostedAt: parseRelativeTimestamp(raw.timestampLabel, now),
    hasImages: raw.imageCount > 0,
    imageCount: raw.imageCount,
    extractionStrategy: canonicalPostUrl ? 'facebook_permalink_dom' : 'text_hash_fallback',
    extractionConfidence: canonicalPostUrl ? (raw.authorName ? 0.9 : 0.82) : 0.45,
    fieldWarnings,
  };
}

function normalizeViaGroupContext(href: string, canonicalGroupUrl?: string) {
  if (!canonicalGroupUrl) return undefined;
  const groupId = canonicalGroupUrl.match(/\/groups\/([^/?#]+)/)?.[1];
  if (!groupId) return undefined;

  const url = new URL(href, 'https://www.facebook.com');
  const storyFbid = url.searchParams.get('story_fbid') ?? url.searchParams.get('multi_permalinks');
  return storyFbid ? `https://www.facebook.com/groups/${groupId}/posts/${storyFbid}` : undefined;
}
