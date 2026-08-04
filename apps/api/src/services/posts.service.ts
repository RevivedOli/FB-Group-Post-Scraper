import crypto from 'node:crypto';
import type { Page } from 'playwright-core';
import { prisma } from '../db/prisma.js';
import { parsePostCandidate } from './post-parser.js';

interface ExtractedPostCandidate {
  canonicalPostUrl: string;
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

interface RawExtractedCandidate {
  candidateId: string;
  canonicalGroupUrl: string;
  links: string[];
  imageCount: number;
  text?: string;
  timestampLabel?: string;
  authorName?: string;
  timestampHoverPoints?: { x: number; y: number }[];
}

export interface ExtractionDiagnostics {
  roleArticleCount: number;
  feedUnitCount: number;
  messageNodeCount: number;
  candidateCount: number;
}

function stableHash(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

async function sleep(ms: number, shouldCancel?: () => boolean) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < ms) {
    if (shouldCancel?.()) return true;
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, ms - (Date.now() - startedAt))));
  }
  return Boolean(shouldCancel?.());
}

function reusableTimestampLabel(label?: string | null) {
  return label && !/^may be an image/i.test(label) ? label : null;
}

async function hoverTimestampAndReadCandidate(page: Page, candidate: RawExtractedCandidate, shouldCancel?: () => boolean) {
  const points = candidate.timestampHoverPoints?.slice(0, 3) ?? [];
  if (points.length === 0) return undefined;

  let bestResult: { links: string[]; timestampLabel?: string; canonicalGroupUrl: string } | undefined;

  for (const point of points) {
    if (shouldCancel?.()) break;
    await page.mouse.move(point.x, point.y).catch(() => undefined);
    if (await sleep(450, shouldCancel)) break;

    const result = await page.evaluate(
    ({ candidateId, groupUrl }) => {
      const element = document.querySelector(`[data-local-monitor-post-id="${candidateId}"]`) as HTMLElement | null;
      if (!element) return undefined;

      const timeLabelPattern = /(^|\s)(now|\d+\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days|w|week|weeks|mo|month|months)\b|yesterday|today|\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\d{1,2}\/\d{1,2}\/\d{2,4})/i;
      const links = [
        ...element.querySelectorAll('a[href]'),
        ...document.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"], a[href*="multi_permalinks"]'),
      ]
        .map((link) => (link as HTMLAnchorElement).href)
        .filter((href) => /facebook\.com/.test(href));
      const timestampLabel = [
        ...element.querySelectorAll('a[aria-label], span[aria-label], abbr[aria-label], a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"], a[href*="multi_permalinks"]'),
      ]
        .map((item) => (item.getAttribute('aria-label') || (item as HTMLElement).innerText || item.getAttribute('title') || '').replace(/\s+/g, ' ').trim())
        .find((label) => label && !/^may be an image/i.test(label) && timeLabelPattern.test(label));

      return { links, timestampLabel, canonicalGroupUrl: groupUrl };
    },
    { candidateId: candidate.candidateId, groupUrl: candidate.canonicalGroupUrl },
  );

    if (result && result.links.length > (bestResult?.links.length ?? 0)) bestResult = result;
  }

  return bestResult;
}

export async function getExtractionDiagnostics(page: Page): Promise<ExtractionDiagnostics> {
  return page.evaluate(() => ({
    roleArticleCount: document.querySelectorAll('[role="article"]').length,
    feedUnitCount: document.querySelectorAll('[data-pagelet*="FeedUnit"], [data-pagelet*="GroupFeed"]').length,
    messageNodeCount: document.querySelectorAll('[data-ad-preview="message"], [data-ad-comet-preview="message"]').length,
    candidateCount: document.querySelectorAll('[role="article"], [data-pagelet*="FeedUnit"], [data-pagelet*="GroupFeed"], [data-ad-preview="message"], [data-ad-comet-preview="message"]').length,
  }));
}

export async function extractVisiblePostsFromPage(
  page: Page,
  groupId: string,
  canonicalGroupUrl: string,
  maxPosts: number,
  maxScrollActions = 2,
  shouldCancel?: () => boolean,
) {
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  if (await sleep(2500, shouldCancel)) return [];

  for (let index = 0; index < maxScrollActions; index += 1) {
    if (shouldCancel?.()) return [];
    const articleCount = await page.locator('[role="article"], [data-pagelet*="FeedUnit"], [data-pagelet*="GroupFeed"]').count().catch(() => 0);
    if (articleCount >= maxPosts) break;
    await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.9)));
    if (await sleep(1800, shouldCancel)) return [];
  }

  const candidates = await page.evaluate(
    ({ maxPosts: pageMaxPosts, groupUrl }) => {
      const uiLabelPattern = /like|comment|share|reply|view|see more|photo|admin|member request|notification|search|menu|reaction/i;
      const timeLabelPattern = /(^|\s)(now|\d+\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days|w|week|weeks|mo|month|months)\b|yesterday|today|\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\d{1,2}\/\d{1,2}\/\d{2,4})/i;
      const postNodes = [
        ...document.querySelectorAll('[role="article"]'),
        ...document.querySelectorAll('[data-pagelet*="FeedUnit"], [data-pagelet*="GroupFeed"]'),
        ...[...document.querySelectorAll('[data-ad-preview="message"], [data-ad-comet-preview="message"]')]
          .map((node) => {
            const structuredParent = node.closest('[role="article"], [data-pagelet*="FeedUnit"], [data-pagelet*="GroupFeed"]');
            if (structuredParent) return structuredParent;

            let candidate = node.parentElement;
            const messageText = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
            for (let depth = 0; candidate && depth < 10; depth += 1) {
              const candidateText = (candidate.textContent ?? '').replace(/\s+/g, ' ').trim();
              const hasMessage = messageText.length === 0 || candidateText.includes(messageText);
              const hasPostLink = Boolean(candidate.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"], a[href*="multi_permalinks"]'));
              const hasPostHeader = Boolean(candidate.querySelector('[data-ad-rendering-role="profile_name"], h2, h3, strong a[href]'));
              if (hasMessage && (hasPostLink || hasPostHeader) && candidateText.length < 30000) return candidate;
              candidate = candidate.parentElement;
            }
            return node;
          }),
      ].slice(0, pageMaxPosts * 3);
      const seenNodes = new Set<Element>();
      return postNodes
        .map((node) => {
          if (seenNodes.has(node)) return undefined;
          seenNodes.add(node);
          const element = node as HTMLElement;
          const candidateId = element.getAttribute('data-local-monitor-post-id') || `post-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          element.setAttribute('data-local-monitor-post-id', candidateId);
          const messageText =
            [...element.querySelectorAll('[data-ad-preview="message"], [data-ad-comet-preview="message"]')]
              .map((messageNode) => ((messageNode as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim())
              .find((value) => value.length > 0) ?? '';
          const rawLines = (element.innerText ?? '')
            .split('\n')
            .map((line) => line.replace(/\s+/g, ' ').trim())
            .filter(Boolean);
          const text = messageText || (element.innerText ?? '').replace(/\s+/g, ' ').trim();
          const anchors = [...element.querySelectorAll('a[href]')] as HTMLAnchorElement[];
          const links = anchors
            .map((link) => (link as HTMLAnchorElement).href)
            .filter((href) => /facebook\.com/.test(href));
          const timestampElements = [
            ...element.querySelectorAll('a, span, abbr, [role="link"], a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"], a[href*="multi_permalinks"]'),
          ];
          const timestampLabel = timestampElements
            .map((item) => (item.getAttribute('aria-label') || (item as HTMLElement).innerText || item.getAttribute('title') || '').replace(/\s+/g, ' ').trim())
            .find((label) => label && !/^may be an image/i.test(label) && timeLabelPattern.test(label))
            ?? rawLines.slice(0, 10).find((label) => timeLabelPattern.test(label));
          const timestampHoverPoints = timestampElements
            .filter((item) => {
            const label = (item.getAttribute('aria-label') || (item as HTMLElement).innerText || item.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
            const href = (item as HTMLAnchorElement).href ?? '';
            const rect = (item as HTMLElement).getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && !/^may be an image/i.test(label) && (timeLabelPattern.test(label) || /\/posts\/|\/permalink\/|story_fbid|multi_permalinks/.test(href));
          })
            .map((item) => {
              const rect = (item as HTMLElement).getBoundingClientRect();
              return {
                x: Math.round(rect.left + rect.width / 2),
                y: Math.round(rect.top + rect.height / 2),
              };
            });
          const authorSelectors = [
            '[data-ad-rendering-role="profile_name"]',
            'h2 strong a',
            'h2 a[role="link"]',
            'h3 strong a',
            'strong a[href]',
            'a[role="link"][href*="facebook.com"]',
            'a[aria-label][href*="facebook.com"]',
          ];
          const authorName = authorSelectors
            .flatMap((selector) => [...element.querySelectorAll(selector)])
            .map((item) => ((item as HTMLElement).innerText || item.getAttribute('aria-label') || item.getAttribute('title') || '').replace(/\s+/g, ' ').trim())
            .find((label) => label.length > 1 && label.length < 100 && !uiLabelPattern.test(label) && !timeLabelPattern.test(label))
            ?? rawLines.slice(0, 8).find((label) => label.length > 1 && label.length < 100 && !uiLabelPattern.test(label) && !timeLabelPattern.test(label));
          const imageCount = [...element.querySelectorAll('img')]
            .filter((image) => {
              const alt = (image.getAttribute('alt') ?? '').toLowerCase();
              const rect = image.getBoundingClientRect();
              const width = Number(image.getAttribute('width') ?? 0) || rect.width;
              const height = Number(image.getAttribute('height') ?? 0) || rect.height;
              return !alt.includes('profile') && !alt.includes('avatar') && width >= 80 && height >= 80;
            }).length;
          return { candidateId, text, links, timestampLabel, authorName, imageCount, canonicalGroupUrl: groupUrl, timestampHoverPoints };
        })
        .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
        .filter((candidate) => candidate.text.length > 30 || candidate.links.length > 0);
    },
    { maxPosts, groupUrl: canonicalGroupUrl },
  ) as RawExtractedCandidate[];

  const seen = new Set<string>();
  const extracted: ExtractedPostCandidate[] = [];

  for (const candidate of candidates) {
    if (shouldCancel?.()) break;
    let parsed = parsePostCandidate(candidate);
    if (!parsed.canonicalPostUrl && candidate.timestampHoverPoints?.length) {
      const hovered = await hoverTimestampAndReadCandidate(page, candidate, shouldCancel);
      if (hovered) parsed = parsePostCandidate({ ...candidate, ...hovered, links: [...candidate.links, ...hovered.links] });
    }

    const text = parsed.text;
    let canonicalPostUrl = parsed.canonicalPostUrl;
    const warnings = [...parsed.fieldWarnings];

    if (!canonicalPostUrl) {
      canonicalPostUrl = `${canonicalGroupUrl}#post-${stableHash(`${groupId}:${text ?? ''}`)}`;
    }

    if (seen.has(canonicalPostUrl)) continue;
    seen.add(canonicalPostUrl);

    extracted.push({
      canonicalPostUrl,
      facebookPostId: parsed.facebookPostId,
      authorName: parsed.authorName,
      text,
      timestampLabel: parsed.timestampLabel,
      originalPostedAt: parsed.originalPostedAt,
      hasImages: parsed.hasImages,
      imageCount: parsed.imageCount,
      extractionStrategy: parsed.extractionStrategy,
      extractionConfidence: parsed.extractionConfidence,
      fieldWarnings: warnings,
    });

    if (extracted.length >= maxPosts) break;
  }

  return extracted;
}

export async function saveExtractedPosts(groupId: string, posts: ExtractedPostCandidate[]) {
  let newPostsSaved = 0;
  let knownPostsSeen = 0;

  for (const post of posts) {
    const existingByUrl = await prisma.post.findUnique({ where: { canonicalPostUrl: post.canonicalPostUrl } });
    const existing =
      existingByUrl ??
      (post.facebookPostId
        ? await prisma.post.findFirst({
            where: {
              groupId,
              canonicalPostUrl: { contains: '#post-' },
              latestCapturedText: post.text,
            },
          })
        : await prisma.post.findFirst({
            where: {
              groupId,
              canonicalPostUrl: { contains: '#post-' },
              latestCapturedText: post.text,
            },
          }));

    if (!existing) newPostsSaved += 1;
    else knownPostsSeen += 1;

    if (existing && existing.canonicalPostUrl !== post.canonicalPostUrl) {
      await prisma.post.update({
        where: { id: existing.id },
        data: {
          facebookPostId: post.facebookPostId ?? existing.facebookPostId,
          canonicalPostUrl: post.canonicalPostUrl,
          authorName: post.authorName ?? existing.authorName,
          latestCapturedText: post.text,
          originalTimestampLabel: post.timestampLabel ?? reusableTimestampLabel(existing.originalTimestampLabel),
          originalPostedAt: post.originalPostedAt ?? existing.originalPostedAt,
          lastObservedAt: new Date(),
          hasImages: post.hasImages || existing.hasImages,
          imageCount: Math.max(post.imageCount, existing.imageCount),
          extractionStrategy: post.extractionStrategy,
          extractionConfidence: post.extractionConfidence,
          fieldWarnings: post.fieldWarnings,
        },
      });
      continue;
    }

    await prisma.post.upsert({
      where: { canonicalPostUrl: post.canonicalPostUrl },
      create: {
        groupId,
        facebookPostId: post.facebookPostId,
        canonicalPostUrl: post.canonicalPostUrl,
        authorName: post.authorName,
        firstCapturedText: post.text,
        latestCapturedText: post.text,
        originalTimestampLabel: post.timestampLabel,
        originalPostedAt: post.originalPostedAt,
        hasImages: post.hasImages,
        imageCount: post.imageCount,
        extractionStrategy: post.extractionStrategy,
        extractionConfidence: post.extractionConfidence,
        fieldWarnings: post.fieldWarnings,
      },
      update: {
        facebookPostId: post.facebookPostId ?? existing?.facebookPostId,
        authorName: post.authorName ?? existing?.authorName,
        latestCapturedText: post.text,
        originalTimestampLabel: post.timestampLabel ?? reusableTimestampLabel(existing?.originalTimestampLabel),
        originalPostedAt: post.originalPostedAt ?? existing?.originalPostedAt,
        lastObservedAt: new Date(),
        hasImages: post.hasImages || Boolean(existing?.hasImages),
        imageCount: Math.max(post.imageCount, existing?.imageCount ?? 0),
        extractionStrategy: post.extractionStrategy,
        extractionConfidence: post.extractionConfidence,
        fieldWarnings: post.fieldWarnings,
      },
    });
  }

  return { postsInspected: posts.length, newPostsSaved, knownPostsSeen };
}

interface CrawlOptions {
  maxPosts: number;
  maxScrollActions: number;
  maxDurationSeconds: number;
  consecutiveKnownLimit: number;
  delayBetweenScrollsMs: number;
  onProgress?: (progress: {
    postsInspected: number;
    newPostsSaved: number;
    knownPostsSeen: number;
    scrollActions: number;
    stopReason?: string;
  }) => Promise<void>;
  shouldCancel?: () => boolean;
}

export async function crawlAndSaveVisiblePosts(page: Page, groupId: string, canonicalGroupUrl: string, options: CrawlOptions) {
  const startedAt = Date.now();
  const seenThisRun = new Set<string>();
  let postsInspected = 0;
  let newPostsSaved = 0;
  let knownPostsSeen = 0;
  let scrollActions = 0;
  let consecutiveKnownPosts = 0;
  let stopReason = 'max_scroll_actions_reached';

  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  if (await sleep(2500, options.shouldCancel)) {
    return { postsInspected, newPostsSaved, knownPostsSeen, scrollActions, stopReason: 'cancelled' };
  }

  while (true) {
    if (options.shouldCancel?.()) {
      stopReason = 'cancelled';
      break;
    }

    if ((Date.now() - startedAt) / 1000 >= options.maxDurationSeconds) {
      stopReason = 'max_duration_reached';
      break;
    }

    const candidates = await extractVisiblePostsFromPage(page, groupId, canonicalGroupUrl, options.maxPosts, 0, options.shouldCancel);
    if (options.shouldCancel?.()) {
      stopReason = 'cancelled';
      break;
    }
    const unseenCandidates = candidates.filter((candidate) => !seenThisRun.has(candidate.canonicalPostUrl));
    unseenCandidates.forEach((candidate) => seenThisRun.add(candidate.canonicalPostUrl));

    if (unseenCandidates.length > 0) {
      const remaining = Math.max(0, options.maxPosts - postsInspected);
      const batch = unseenCandidates.slice(0, remaining);
      if (options.shouldCancel?.()) {
        stopReason = 'cancelled';
        break;
      }
      const saved = await saveExtractedPosts(groupId, batch);
      postsInspected += saved.postsInspected;
      newPostsSaved += saved.newPostsSaved;
      knownPostsSeen += saved.knownPostsSeen;

      consecutiveKnownPosts = saved.newPostsSaved === 0 ? consecutiveKnownPosts + saved.knownPostsSeen : 0;

      await options.onProgress?.({ postsInspected, newPostsSaved, knownPostsSeen, scrollActions });
    }

    if (postsInspected >= options.maxPosts) {
      stopReason = 'max_posts_reached';
      break;
    }

    if (consecutiveKnownPosts >= options.consecutiveKnownLimit) {
      stopReason = 'consecutive_known_posts_reached';
      break;
    }

    if (scrollActions >= options.maxScrollActions) break;

    const beforeHeight = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 0);
    if (options.shouldCancel?.()) {
      stopReason = 'cancelled';
      break;
    }
    await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 1.25)));
    scrollActions += 1;
    await options.onProgress?.({ postsInspected, newPostsSaved, knownPostsSeen, scrollActions });
    if (await sleep(options.delayBetweenScrollsMs, options.shouldCancel)) {
      stopReason = 'cancelled';
      break;
    }
    const afterHeight = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => beforeHeight);
    if (afterHeight <= beforeHeight && unseenCandidates.length === 0) {
      stopReason = 'end_of_feed_or_no_growth';
      break;
    }
  }

  await options.onProgress?.({ postsInspected, newPostsSaved, knownPostsSeen, scrollActions, stopReason });
  return { postsInspected, newPostsSaved, knownPostsSeen, scrollActions, stopReason };
}

export async function listPosts(page = 1, pageSize = 25) {
  const skip = Math.max(0, page - 1) * pageSize;
  const [items, total] = await Promise.all([
    prisma.post.findMany({
      orderBy: { firstDiscoveredAt: 'desc' },
      skip,
      take: pageSize,
      include: { group: { select: { friendlyName: true } } },
    }),
    prisma.post.count(),
  ]);
  return { items, total };
}

export async function deletePost(id: string) {
  return prisma.post.delete({ where: { id } });
}
