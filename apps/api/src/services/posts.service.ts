import crypto from 'node:crypto';
import type { Page } from 'playwright-core';
import { reviewStatuses } from '@local-group-monitor/shared';
import { prisma } from '../db/prisma.js';
import { queuePostAfterScrape } from './ai-assessment.service.js';
import { parsePostCandidate } from './post-parser.js';
import { moveRealCursorToPagePoint } from './real-cursor.service.js';

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
  timestampHoverPoints?: { x: number; y: number; targetId?: string; label?: string; href?: string }[];
  debugPoint?: { x: number; y: number };
}

type CandidateLinkResult = { links: string[]; timestampLabel?: string; canonicalGroupUrl: string };
type HoverDebug = {
  x: number;
  y: number;
  label: string;
  targetTag?: string;
  targetId?: string;
  targetClass?: string;
  targetText?: string;
  targetHref?: string;
  pointTag?: string;
  pointId?: string;
  pointClass?: string;
  pointText?: string;
  pointHref?: string;
  canonicalPostUrl?: string;
};

interface TimestampHoverOptions {
  useRealCursorForPermalinks?: boolean;
  realCursorMoveDurationMs?: number;
  realCursorOffsetX?: number;
  realCursorOffsetY?: number;
  permalinkProbeLimit?: number;
  permalinkProbeDwellMs?: number;
  permalinkProbePauseMs?: number;
}

function isDirectFacebookPostUrl(url?: string | null) {
  return Boolean(url && /facebook\.com\/groups\/[^/]+\/posts\/\d+/i.test(url));
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

function formatHoverDebug(debug: HoverDebug) {
  const rows = [
    debug.label,
    `point: ${debug.x},${debug.y}`,
    debug.targetTag ? `target: ${debug.targetTag}${debug.targetId ? `#${debug.targetId}` : ''}` : undefined,
    debug.targetClass ? `target class: ${debug.targetClass}` : undefined,
    debug.targetText ? `target text: ${debug.targetText}` : undefined,
    debug.targetHref ? `target href: ${debug.targetHref}` : undefined,
    debug.pointTag ? `under cursor: ${debug.pointTag}${debug.pointId ? `#${debug.pointId}` : ''}` : undefined,
    debug.pointClass ? `under class: ${debug.pointClass}` : undefined,
    debug.pointText ? `under text: ${debug.pointText}` : undefined,
    debug.pointHref ? `under href: ${debug.pointHref}` : undefined,
    debug.canonicalPostUrl ? `usable URL: ${debug.canonicalPostUrl}` : undefined,
  ];
  return rows.filter(Boolean).join('\n');
}

async function showScraperOverlay(page: Page, candidateId: string, point: { x: number; y: number }, label: string) {
  await page.evaluate(
    ({ candidateId: overlayCandidateId, point: overlayPoint, label: overlayLabel }) => {
      const element = document.querySelector(`[data-local-monitor-post-id="${overlayCandidateId}"]`) as HTMLElement | null;
      const rect = element?.getBoundingClientRect();
      let root = document.getElementById('local-monitor-scraper-overlay');
      if (!root) {
        root = document.createElement('div');
        root.id = 'local-monitor-scraper-overlay';
        root.setAttribute('aria-hidden', 'true');
        document.documentElement.appendChild(root);
      }

      root.innerHTML = `
        <div data-local-monitor-overlay-post></div>
        <div data-local-monitor-overlay-dot></div>
        <div data-local-monitor-overlay-label></div>
      `;
      root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:Arial,sans-serif;';

      const post = root.querySelector('[data-local-monitor-overlay-post]') as HTMLElement | null;
      if (post && rect) {
        post.style.cssText = [
          'position:fixed',
          `left:${Math.max(0, rect.left - 4)}px`,
          `top:${Math.max(0, rect.top - 4)}px`,
          `width:${Math.max(0, rect.width + 8)}px`,
          `height:${Math.max(0, rect.height + 8)}px`,
          'border:3px solid #1a73e8',
          'border-radius:10px',
          'box-shadow:0 0 0 9999px rgba(26,115,232,0.08)',
        ].join(';');
      }

      const dot = root.querySelector('[data-local-monitor-overlay-dot]') as HTMLElement | null;
      if (dot) {
        dot.style.cssText = [
          'position:fixed',
          `left:${overlayPoint.x - 8}px`,
          `top:${overlayPoint.y - 8}px`,
          'width:16px',
          'height:16px',
          'border-radius:999px',
          'background:#fbbc04',
          'border:3px solid #202124',
          'box-shadow:0 2px 10px rgba(0,0,0,0.35)',
        ].join(';');
      }

      const labelNode = root.querySelector('[data-local-monitor-overlay-label]') as HTMLElement | null;
      if (labelNode) {
        labelNode.textContent = overlayLabel;
        labelNode.style.cssText = [
          'position:fixed',
          `left:${Math.min(window.innerWidth - 470, Math.max(8, overlayPoint.x + 14))}px`,
          `top:${Math.min(window.innerHeight - 44, Math.max(8, overlayPoint.y - 18))}px`,
          'max-width:460px',
          'padding:6px 8px',
          'border-radius:6px',
          'background:#202124',
          'color:#fff',
          'font-size:12px',
          'font-weight:700',
          'line-height:1.2',
          'white-space:pre-wrap',
          'word-break:break-word',
          'box-shadow:0 2px 10px rgba(0,0,0,0.3)',
        ].join(';');
      }
    },
    { candidateId, point, label },
  ).catch(() => undefined);
}

async function readHoverDebug(page: Page, candidate: RawExtractedCandidate, point: NonNullable<RawExtractedCandidate['timestampHoverPoints']>[number], label: string) {
  const debug = await page.evaluate(
    ({ candidateId, hoverPoint, debugLabel }) => {
      const element = document.querySelector(`[data-local-monitor-post-id="${candidateId}"]`) as HTMLElement | null;
      const target = hoverPoint.targetId && element
        ? element.querySelector(`[data-local-monitor-timestamp-id="${hoverPoint.targetId}"]`)
        : null;
      const pointNode = document.elementFromPoint(hoverPoint.x, hoverPoint.y);
      const targetLink = target ? ((target.matches('a[href]') ? target : target.closest('a[href]') ?? target.querySelector('a[href]')) as HTMLAnchorElement | null) : null;
      const pointLink = pointNode ? ((pointNode.matches('a[href]') ? pointNode : pointNode.closest('a[href]') ?? pointNode.querySelector('a[href]')) as HTMLAnchorElement | null) : null;
      return {
        x: hoverPoint.x,
        y: hoverPoint.y,
        label: debugLabel,
        targetTag: target?.tagName.toLowerCase(),
        targetId: ((target as HTMLElement | null)?.id ?? '').replace(/\s+/g, ' ').trim().slice(0, 180),
        targetClass: ((target as HTMLElement | null)?.className?.toString() ?? '').replace(/\s+/g, ' ').trim().slice(0, 220),
        targetText: (((target as HTMLElement | null)?.innerText || target?.textContent) ?? '').replace(/\s+/g, ' ').trim().slice(0, 180),
        targetHref: targetLink?.href,
        pointTag: pointNode?.tagName.toLowerCase(),
        pointId: ((pointNode as HTMLElement | null)?.id ?? '').replace(/\s+/g, ' ').trim().slice(0, 180),
        pointClass: ((pointNode as HTMLElement | null)?.className?.toString() ?? '').replace(/\s+/g, ' ').trim().slice(0, 220),
        pointText: (((pointNode as HTMLElement | null)?.innerText || pointNode?.textContent) ?? '').replace(/\s+/g, ' ').trim().slice(0, 180),
        pointHref: pointLink?.href,
      };
    },
    { candidateId: candidate.candidateId, hoverPoint: point, debugLabel: label },
  ).catch(() => undefined);
  return debug as HoverDebug | undefined;
}

async function clearScraperOverlay(page: Page) {
  await page.evaluate(() => {
    document.getElementById('local-monitor-scraper-overlay')?.remove();
  }).catch(() => undefined);
}

async function showPageOverlay(page: Page, label: string) {
  await page.evaluate((overlayLabel) => {
    let root = document.getElementById('local-monitor-scraper-overlay');
    if (!root) {
      root = document.createElement('div');
      root.id = 'local-monitor-scraper-overlay';
      root.setAttribute('aria-hidden', 'true');
      document.documentElement.appendChild(root);
    }
    root.innerHTML = '<div data-local-monitor-overlay-label></div>';
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:Arial,sans-serif;';
    const labelNode = root.querySelector('[data-local-monitor-overlay-label]') as HTMLElement | null;
    if (labelNode) {
      labelNode.textContent = overlayLabel;
      labelNode.style.cssText = [
        'position:fixed',
        'left:16px',
        'top:88px',
        'max-width:460px',
        'padding:8px 10px',
        'border-radius:6px',
        'background:#202124',
        'color:#fff',
        'font-size:12px',
        'font-weight:700',
        'line-height:1.2',
        'white-space:pre-wrap',
        'word-break:break-word',
        'box-shadow:0 2px 10px rgba(0,0,0,0.3)',
      ].join(';');
    }
  }, label).catch(() => undefined);
}

async function hoverTimestampTarget(page: Page, point: NonNullable<RawExtractedCandidate['timestampHoverPoints']>[number], options: TimestampHoverOptions = {}) {
  if (options.useRealCursorForPermalinks) {
    const result = await moveRealCursorToPagePoint(page, point, {
      durationMs: options.realCursorMoveDurationMs ?? 450,
      offsetX: options.realCursorOffsetX,
      offsetY: options.realCursorOffsetY,
    });
    if (result.moved) return result.message;
    await page.mouse.move(point.x, point.y).catch(() => undefined);
    return result.message;
  }

  if (point.targetId) {
    const selector = `[data-local-monitor-timestamp-id="${point.targetId}"]`;
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    if (count > 0) {
      await locator.first().hover({ timeout: 2000 }).catch(async () => {
        await page.mouse.move(point.x, point.y).catch(() => undefined);
      });
      return;
    }
  }
  await page.mouse.move(point.x, point.y).catch(() => undefined);
  return 'Playwright cursor moved.';
}

async function readCandidateLinks(page: Page, candidate: RawExtractedCandidate, point: NonNullable<RawExtractedCandidate['timestampHoverPoints']>[number]) {
  return page.evaluate(
    ({ candidateId, groupUrl, hoverPoint }) => {
      const element = document.querySelector(`[data-local-monitor-post-id="${candidateId}"]`) as HTMLElement | null;
      if (!element) return undefined;

      const timeLabelPattern = /(^|\s)(now|\d+\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days|w|week|weeks|mo|month|months)\b|yesterday|today|\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\d{1,2}\/\d{1,2}\/\d{2,4})/i;
      const target = hoverPoint.targetId
        ? element.querySelector(`[data-local-monitor-timestamp-id="${hoverPoint.targetId}"]`) as HTMLElement | null
        : null;
      const targetLink = target
        ? ((target.matches('a[href]') ? target : target.querySelector('a[href]') ?? target.closest('a[href]')) as HTMLAnchorElement | null)
        : null;
      const targetParent = target?.parentElement ?? null;
      const targetGrandparent = targetParent?.parentElement ?? null;
      const links = [
        targetLink?.href,
        ...[target, targetParent, targetGrandparent].flatMap((node) => node ? [...node.querySelectorAll('a[href]')].map((link) => (link as HTMLAnchorElement).href) : []),
        ...[...element.querySelectorAll('a[href]')].map((link) => (link as HTMLAnchorElement).href),
        ...[...document.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"], a[href*="multi_permalinks"]')]
          .filter((link) => {
            if (element.contains(link)) return true;
            const rect = (link as HTMLElement).getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return false;
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            return Math.abs(centerX - hoverPoint.x) <= 220 && Math.abs(centerY - hoverPoint.y) <= 160;
          })
          .map((link) => (link as HTMLAnchorElement).href),
      ].filter((href): href is string => typeof href === 'string' && /facebook\.com/.test(href));
      const timestampLabel = [
        target,
        targetParent,
        targetGrandparent,
        ...element.querySelectorAll('a[aria-label], span[aria-label], abbr[aria-label], a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"], a[href*="multi_permalinks"]'),
      ]
        .filter((item): item is Element => Boolean(item))
        .map((item) => (item.getAttribute('aria-label') || (item as HTMLElement).innerText || item.getAttribute('title') || '').replace(/\s+/g, ' ').trim())
        .find((label) => label && !/^may be an image/i.test(label) && timeLabelPattern.test(label));

      return { links, timestampLabel, canonicalGroupUrl: groupUrl };
    },
    { candidateId: candidate.candidateId, groupUrl: candidate.canonicalGroupUrl, hoverPoint: point },
  );
}

async function refreshTimestampPoint(page: Page, candidate: RawExtractedCandidate, point: NonNullable<RawExtractedCandidate['timestampHoverPoints']>[number], shouldCancel?: () => boolean) {
  if (!point.targetId) return point;

  const selector = `[data-local-monitor-post-id="${candidate.candidateId}"] [data-local-monitor-timestamp-id="${point.targetId}"]`;
  const needsScroll = await page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector) as HTMLElement | null;
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    return rect.top < 170 || rect.bottom > window.innerHeight - 90;
  }, selector).catch(() => false);

  if (needsScroll) {
    await page.evaluate((targetSelector) => {
      const target = document.querySelector(targetSelector) as HTMLElement | null;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const desiredTop = Math.min(Math.max(190, window.innerHeight * 0.28), Math.max(190, window.innerHeight - 220));
      window.scrollBy(0, Math.round(rect.top - desiredTop));
    }, selector).catch(() => undefined);
    await sleep(450, shouldCancel);
  }

  const updated = await page.evaluate(
    ({ targetSelector, fallback }) => {
      const target = document.querySelector(targetSelector) as HTMLElement | null;
      if (!target) return fallback;
      const rect = target.getBoundingClientRect();
      const link = (target.matches('a[href]') ? target : target.querySelector('a[href]') ?? target.closest('a[href]')) as HTMLAnchorElement | null;
      return {
        ...fallback,
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        label: (target.getAttribute('aria-label') || target.innerText || target.getAttribute('title') || fallback.label || '').replace(/\s+/g, ' ').trim(),
        href: link?.href ?? fallback.href ?? '',
      };
    },
    { targetSelector: selector, fallback: point },
  ).catch(() => point);

  return updated;
}

async function hoverTimestampAndReadCandidate(page: Page, candidate: RawExtractedCandidate, shouldCancel?: () => boolean, options: TimestampHoverOptions = {}) {
  const probeLimit = Math.max(1, Math.min(5, options.permalinkProbeLimit ?? 2));
  const probeDwellMs = Math.max(150, Math.min(5000, options.permalinkProbeDwellMs ?? 700));
  const probePauseMs = Math.max(0, Math.min(3000, options.permalinkProbePauseMs ?? 250));
  const points = candidate.timestampHoverPoints?.slice(0, probeLimit) ?? [];
  if (points.length === 0) {
    if (candidate.debugPoint) {
      const debug = await readHoverDebug(page, candidate, candidate.debugPoint, 'No timestamp target found');
      await showScraperOverlay(page, candidate.candidateId, candidate.debugPoint, debug ? formatHoverDebug(debug) : 'No timestamp target found');
      await sleep(250, shouldCancel);
      const fallbackPoint = { ...candidate.debugPoint, label: 'fallback probe' };
      const cursorMessage = await hoverTimestampTarget(page, fallbackPoint, options);
      let result: CandidateLinkResult | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (await sleep(probeDwellMs, shouldCancel)) break;
        result = await readCandidateLinks(page, candidate, fallbackPoint);
        const parsedDuringDwell = result ? parsePostCandidate({ ...candidate, ...result, links: [...candidate.links, ...result.links] }) : undefined;
        if (isDirectFacebookPostUrl(parsedDuringDwell?.canonicalPostUrl)) break;
      }
      const parsed = result ? parsePostCandidate({ ...candidate, ...result, links: [...candidate.links, ...result.links] }) : undefined;
      const afterDebug = await readHoverDebug(page, candidate, fallbackPoint, parsed?.canonicalPostUrl ? 'Fallback permalink captured' : 'Fallback hover complete');
      const afterLabel = [cursorMessage, afterDebug ? formatHoverDebug({ ...afterDebug, canonicalPostUrl: parsed?.canonicalPostUrl }) : 'Fallback hover complete']
        .filter(Boolean)
        .join('\n');
      await showScraperOverlay(page, candidate.candidateId, fallbackPoint, afterLabel);
      await sleep(probePauseMs, shouldCancel);
      if (result) return result;
    }
    return undefined;
  }

  let bestResult: CandidateLinkResult | undefined;

  for (const point of points) {
    if (shouldCancel?.()) break;
    const refreshedPoint = await refreshTimestampPoint(page, candidate, point, shouldCancel);
    const beforeDebug = await readHoverDebug(page, candidate, refreshedPoint, `Hovering timestamp: ${refreshedPoint.label || refreshedPoint.href || 'target'}`);
    await showScraperOverlay(page, candidate.candidateId, refreshedPoint, beforeDebug ? formatHoverDebug(beforeDebug) : `Hovering timestamp: ${refreshedPoint.label || refreshedPoint.href || 'target'}`);
    await sleep(250, shouldCancel);
    const cursorMessage = await hoverTimestampTarget(page, refreshedPoint, options);
    let result: CandidateLinkResult | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (await sleep(probeDwellMs, shouldCancel)) break;
      result = await readCandidateLinks(page, candidate, refreshedPoint);
      const parsedDuringDwell = result ? parsePostCandidate({ ...candidate, ...result, links: [...candidate.links, ...result.links] }) : undefined;
      if (isDirectFacebookPostUrl(parsedDuringDwell?.canonicalPostUrl)) break;
    }

    const parsed = result ? parsePostCandidate({ ...candidate, ...result, links: [...candidate.links, ...result.links] }) : undefined;
    const afterDebug = await readHoverDebug(page, candidate, refreshedPoint, parsed?.canonicalPostUrl ? 'Permalink captured' : 'Hovered timestamp');
    const afterLabel = [cursorMessage, afterDebug ? formatHoverDebug({ ...afterDebug, canonicalPostUrl: parsed?.canonicalPostUrl }) : parsed?.canonicalPostUrl ? `Permalink captured: ${parsed.canonicalPostUrl}` : 'Hovered timestamp']
      .filter(Boolean)
      .join('\n');
    await showScraperOverlay(
      page,
      candidate.candidateId,
      refreshedPoint,
      afterLabel,
    );
    await sleep(probePauseMs, shouldCancel);

    if (isDirectFacebookPostUrl(parsed?.canonicalPostUrl) && result) {
      return result;
    }

    if (result && result.links.length > (bestResult?.links.length ?? 0)) {
      bestResult = result;
    }
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
  hoverOptions: TimestampHoverOptions = {},
) {
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  if (await sleep(2500, shouldCancel)) return [];
  await showPageOverlay(page, 'Scanning visible posts');

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
      const storyMessageSelector = '[data-ad-rendering-role="story_message"] [data-ad-preview="message"], [data-ad-rendering-role="story_message"] [data-ad-comet-preview="message"]';
      const safeTop = Math.min(260, Math.max(175, window.innerHeight * 0.16));
      const postNodes = [
        ...[...document.querySelectorAll(storyMessageSelector)]
          .map((node) => {
            const messageText = ((node as HTMLElement).innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
            const viable: Element[] = [];
            let candidate: Element | null = node;
            for (let depth = 0; candidate && depth < 14; depth += 1) {
              const rect = (candidate as HTMLElement).getBoundingClientRect();
              const text = ((candidate as HTMLElement).innerText || candidate.textContent || '').replace(/\s+/g, ' ').trim();
              const containsMessage = messageText.length === 0 || text.includes(messageText.slice(0, Math.min(120, messageText.length)));
              const nestedArticles = [...candidate.querySelectorAll('[role="article"]')].filter((article) => article !== candidate);
              const candidateRect = (candidate as HTMLElement).getBoundingClientRect();
              const primaryTimestamp = [...candidate.querySelectorAll('span.xjp7ctv[id]')].some((item) => {
                const nearestArticle = item.closest('[role="article"]');
                if (nearestArticle && nearestArticle !== candidate) return false;
                const itemRect = (item as HTMLElement).getBoundingClientRect();
                const headerLimit = Math.min(220, Math.max(120, candidateRect.height * 0.32));
                return itemRect.width > 0 && itemRect.height > 0 && itemRect.top >= candidateRect.top - 8 && itemRect.top - candidateRect.top <= headerLimit;
              });
              const fallbackTimestamp = primaryTimestamp ? false : [...candidate.querySelectorAll('a[href], span[id], abbr, [role="link"]')].some((item) => {
                const nearestArticle = item.closest('[role="article"]');
                if (nearestArticle && nearestArticle !== candidate) return false;
                const itemRect = (item as HTMLElement).getBoundingClientRect();
                const label = (item.getAttribute('aria-label') || (item as HTMLElement).innerText || item.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
                const link = (item.matches('a[href]') ? item : item.querySelector('a[href]') ?? item.closest('a[href]')) as HTMLAnchorElement | null;
                const href = link?.href ?? '';
                const headerLimit = Math.min(220, Math.max(120, candidateRect.height * 0.32));
                const isInHeader = itemRect.width > 0 && itemRect.height > 0 && itemRect.top >= candidateRect.top - 8 && itemRect.top - candidateRect.top <= headerLimit;
                const isShortTime = label.length > 0 && label.length <= 40 && timeLabelPattern.test(label);
                const isTimestampLink = /\/posts\/|\/permalink\/|story_fbid|multi_permalinks/.test(href) && itemRect.height <= 44;
                return isInHeader && (isShortTime || isTimestampLink);
              });
              const hasHeader = Boolean(candidate.querySelector('[data-ad-rendering-role="profile_name"], h2, h3, strong a[href]'));
              if (rect.width > 0 && rect.height > 0 && text.length >= 30 && text.length < 30000 && containsMessage && (candidate.matches('[role="article"]') || nestedArticles.length <= 1) && Boolean(candidate.querySelector(storyMessageSelector)) && (primaryTimestamp || fallbackTimestamp || hasHeader)) {
                viable.push(candidate);
              }
              candidate = candidate.parentElement;
            }
            viable.sort((left, right) => {
              const leftRect = (left as HTMLElement).getBoundingClientRect();
              const rightRect = (right as HTMLElement).getBoundingClientRect();
              return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
            });
            return viable[0] ?? node.closest('[role="article"]') ?? node;
          }),
        ...[...document.querySelectorAll('[role="article"]')].filter((node) => !node.parentElement?.closest('[role="article"]')),
        ...document.querySelectorAll('[data-pagelet*="FeedUnit"], [data-pagelet*="GroupFeed"]'),
        ...[...document.querySelectorAll('[data-ad-preview="message"], [data-ad-comet-preview="message"]')]
          .map((node) => {
            const messageText = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
            let candidate = node.parentElement;
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
      ]
        .filter((node): node is Element => Boolean(node))
        .filter((node) => {
          const rect = (node as HTMLElement).getBoundingClientRect();
          if (rect.width <= 280 || rect.height <= 80) return false;
          if (rect.bottom <= safeTop || rect.top >= window.innerHeight - 80) return false;
          if (rect.left >= window.innerWidth * 0.68) return false;
          if (rect.right <= window.innerWidth * 0.08) return false;
          if (rect.top < safeTop && rect.height < 240) return false;
          const text = ((node as HTMLElement).innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
          if (text.length < 30 || text.length > 30000) return false;
          if (!node.querySelector(storyMessageSelector)) return false;
          const nearestMain = node.closest('[role="main"], [role="feed"], [data-pagelet*="GroupFeed"], [data-pagelet*="FeedUnit"]');
          if (!nearestMain && !node.matches('[role="article"]')) return false;
          return true;
        })
        .slice(0, pageMaxPosts * 3);
      const seenNodes = new Set<Element>();
      return postNodes
        .map((node) => {
          if (seenNodes.has(node)) return undefined;
          seenNodes.add(node);
          const element = node as HTMLElement;
          const candidateRect = element.getBoundingClientRect();
          if (candidateRect.bottom <= safeTop || candidateRect.top >= window.innerHeight - 80) return undefined;
          if (candidateRect.left >= window.innerWidth * 0.68 || candidateRect.right <= window.innerWidth * 0.08) return undefined;
          const candidateId = element.getAttribute('data-local-monitor-post-id') || `post-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          element.setAttribute('data-local-monitor-post-id', candidateId);
          const storyMessageNodes = [...element.querySelectorAll(storyMessageSelector)]
            .filter((messageNode) => {
              const rect = (messageNode as HTMLElement).getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
          const fallbackMessageNodes = [...element.querySelectorAll('[data-ad-preview="message"], [data-ad-comet-preview="message"]')]
            .filter((messageNode) => {
              const nearestArticle = messageNode.closest('[role="article"]');
              if (nearestArticle && nearestArticle !== element) return false;
              const candidateRect = element.getBoundingClientRect();
              const rect = (messageNode as HTMLElement).getBoundingClientRect();
              const messageLimit = Math.min(420, Math.max(140, candidateRect.height * 0.55));
              return rect.top >= candidateRect.top - 4 && rect.top - candidateRect.top <= messageLimit;
            });
          const messageNodes = storyMessageNodes.length > 0 ? storyMessageNodes : fallbackMessageNodes;
          const messageText =
            messageNodes
              .map((messageNode) => ((messageNode as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim())
              .find((value) => value.length > 0) ?? '';
          const rawLines = (element.innerText ?? '')
            .split('\n')
            .map((line) => line.replace(/\s+/g, ' ').trim())
            .filter(Boolean);
          const text = messageText || (element.innerText ?? '').replace(/\s+/g, ' ').trim();
          if (storyMessageNodes.length === 0 && /\breply\b.*\bshare\b/i.test(text)) return undefined;
          const anchors = [...element.querySelectorAll('a[href]')] as HTMLAnchorElement[];
          const links = anchors
            .filter((link) => {
              const nearestArticle = link.closest('[role="article"]');
              if (nearestArticle && nearestArticle !== element) return false;
              const candidateRect = element.getBoundingClientRect();
              const rect = link.getBoundingClientRect();
              const headerLimit = Math.min(115, Math.max(72, candidateRect.height * 0.18));
              return !nearestArticle || rect.top - candidateRect.top <= headerLimit;
            })
            .map((link) => (link as HTMLAnchorElement).href)
            .filter((href) => /facebook\.com/.test(href));
          const primaryTimestampElements = [...element.querySelectorAll('span.xjp7ctv[id]')]
            .filter((item) => {
              const nearestArticle = item.closest('[role="article"]');
              if (nearestArticle && nearestArticle !== element) return false;
              const rect = (item as HTMLElement).getBoundingClientRect();
              const headerLimit = Math.min(185, Math.max(105, candidateRect.height * 0.28));
              const isInHeader = rect.width > 0 && rect.height > 0 && rect.top >= Math.max(safeTop, candidateRect.top - 6) && rect.top - candidateRect.top <= headerLimit;
              return isInHeader;
            });
          const fallbackTimestampElements = primaryTimestampElements.length > 0
            ? []
            : [...element.querySelectorAll('a[href], span[id], abbr, [role="link"]')]
              .filter((item) => {
                const nearestArticle = item.closest('[role="article"]');
                if (nearestArticle && nearestArticle !== element) return false;
                const rect = (item as HTMLElement).getBoundingClientRect();
                const label = (item.getAttribute('aria-label') || (item as HTMLElement).innerText || item.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
                const link = (item.matches('a[href]') ? item : item.querySelector('a[href]') ?? item.closest('a[href]')) as HTMLAnchorElement | null;
                const href = link?.href ?? '';
                const headerLimit = Math.min(185, Math.max(105, candidateRect.height * 0.28));
                const isInHeader = rect.width > 0 && rect.height > 0 && rect.top >= Math.max(safeTop, candidateRect.top - 6) && rect.top - candidateRect.top <= headerLimit;
              const isShortTime = label.length > 0 && label.length <= 40 && timeLabelPattern.test(label);
              const isTimestampLink = /\/posts\/|\/permalink\/|story_fbid|multi_permalinks/.test(href) && rect.height <= 44;
                return isInHeader && (isShortTime || isTimestampLink);
              });
          const timestampElements = [...primaryTimestampElements, ...fallbackTimestampElements]
            .sort((left, right) => {
              const score = (item: Element) => {
                const label = (item.getAttribute('aria-label') || (item as HTMLElement).innerText || item.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
                const link = (item.matches('a[href]') ? item : item.querySelector('a[href]') ?? item.closest('a[href]')) as HTMLAnchorElement | null;
                const href = link?.href ?? '';
                return (item.matches('span.xjp7ctv[id]') ? 10 : 0) + (timeLabelPattern.test(label) ? 4 : 0) + (/\/posts\/|\/permalink\/|story_fbid|multi_permalinks/.test(href) ? 3 : 0);
              };
              return score(right) - score(left);
            });
          const timestampLabel = timestampElements
            .map((item) => (item.getAttribute('aria-label') || (item as HTMLElement).innerText || item.getAttribute('title') || '').replace(/\s+/g, ' ').trim())
            .find((label) => label && label.length <= 80 && !/^may be an image/i.test(label) && timeLabelPattern.test(label))
            ?? rawLines.slice(0, 6).find((label) => label.length <= 12 && timeLabelPattern.test(label));
          const timestampHoverPoints = timestampElements
            .slice(0, 5)
            .map((item, itemIndex) => {
              const rect = (item as HTMLElement).getBoundingClientRect();
              const targetId = (item as HTMLElement).dataset.localMonitorTimestampId || `ts-${candidateId}-${itemIndex}`;
              const link = (item.matches('a[href]') ? item : item.querySelector('a[href]') ?? item.closest('a[href]')) as HTMLAnchorElement | null;
              (item as HTMLElement).dataset.localMonitorTimestampId = targetId;
              return {
                x: Math.round(rect.left + rect.width / 2),
                y: Math.round(rect.top + rect.height / 2),
                targetId,
                label: (item.getAttribute('aria-label') || (item as HTMLElement).innerText || item.getAttribute('title') || '').replace(/\s+/g, ' ').trim(),
                href: link?.href ?? '',
              };
            });
          const fallbackHoverPoints = timestampHoverPoints.length > 0
            ? []
            : [...element.querySelectorAll('a[href], [role="link"]')]
              .filter((item) => {
                const rect = (item as HTMLElement).getBoundingClientRect();
                const link = (item.matches('a[href]') ? item : item.querySelector('a[href]') ?? item.closest('a[href]')) as HTMLAnchorElement | null;
                const href = link?.href ?? '';
                if (!/facebook\.com/.test(href)) return false;
                if (rect.width <= 0 || rect.height <= 0) return false;
                if (rect.top < safeTop || rect.bottom > window.innerHeight - 24) return false;
                const withinPost = rect.top >= candidateRect.top - 8 && rect.top - candidateRect.top <= Math.min(360, Math.max(140, candidateRect.height * 0.58));
                return withinPost;
              })
              .slice(0, 5)
              .map((item, itemIndex) => {
                const rect = (item as HTMLElement).getBoundingClientRect();
                const targetId = (item as HTMLElement).dataset.localMonitorTimestampId || `fallback-${candidateId}-${itemIndex}`;
                const link = (item.matches('a[href]') ? item : item.querySelector('a[href]') ?? item.closest('a[href]')) as HTMLAnchorElement | null;
                (item as HTMLElement).dataset.localMonitorTimestampId = targetId;
                return {
                  x: Math.round(rect.left + rect.width / 2),
                  y: Math.round(rect.top + rect.height / 2),
                  targetId,
                  label: (item.getAttribute('aria-label') || (item as HTMLElement).innerText || item.getAttribute('title') || 'fallback link').replace(/\s+/g, ' ').trim(),
                  href: link?.href ?? '',
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
            .filter((item) => {
              const nearestArticle = item.closest('[role="article"]');
              if (nearestArticle && nearestArticle !== element) return false;
              const candidateRect = element.getBoundingClientRect();
              const rect = (item as HTMLElement).getBoundingClientRect();
              const headerLimit = Math.min(115, Math.max(72, candidateRect.height * 0.18));
              return rect.top >= candidateRect.top - 4 && rect.top - candidateRect.top <= headerLimit;
            })
            .map((item) => ((item as HTMLElement).innerText || item.getAttribute('aria-label') || item.getAttribute('title') || '').replace(/\s+/g, ' ').trim())
            .find((label) => label.length > 1 && label.length < 100 && !uiLabelPattern.test(label) && !timeLabelPattern.test(label))
            ?? rawLines.slice(0, 8).find((label) => label.length > 1 && label.length < 100 && !uiLabelPattern.test(label) && !timeLabelPattern.test(label));
          const imageCount = [...element.querySelectorAll('img')]
            .filter((image) => {
              const nearestArticle = image.closest('[role="article"]');
              if (nearestArticle && nearestArticle !== element) return false;
              const alt = (image.getAttribute('alt') ?? '').toLowerCase();
              const rect = image.getBoundingClientRect();
              const width = Number(image.getAttribute('width') ?? 0) || rect.width;
              const height = Number(image.getAttribute('height') ?? 0) || rect.height;
              return !alt.includes('profile') && !alt.includes('avatar') && width >= 80 && height >= 80;
            }).length;
          const debugPoint = {
            x: Math.round(Math.min(window.innerWidth - 24, Math.max(24, candidateRect.left + 24))),
            y: Math.round(Math.min(window.innerHeight - 24, Math.max(24, candidateRect.top + 24))),
          };
          return { candidateId, text, links, timestampLabel, authorName, imageCount, canonicalGroupUrl: groupUrl, timestampHoverPoints: timestampHoverPoints.length > 0 ? timestampHoverPoints : fallbackHoverPoints, debugPoint };
        })
        .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
        .filter((candidate) => candidate.text.length > 30 || candidate.links.length > 0);
    },
    { maxPosts, groupUrl: canonicalGroupUrl },
  ) as RawExtractedCandidate[];

  if (candidates.length === 0) {
    await showPageOverlay(page, 'No visible post candidates found');
    await sleep(900, shouldCancel);
  }

  const seen = new Set<string>();
  const extracted: ExtractedPostCandidate[] = [];

  for (const candidate of candidates) {
    if (shouldCancel?.()) break;
    let parsed = parsePostCandidate(candidate);
    const hovered = await hoverTimestampAndReadCandidate(page, candidate, shouldCancel, hoverOptions);
    if (hovered) parsed = parsePostCandidate({ ...candidate, ...hovered, links: [...candidate.links, ...hovered.links] });

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

  await clearScraperOverlay(page);
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
      const updatedPost = await prisma.post.update({
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
      void queuePostAfterScrape(updatedPost.id);
      continue;
    }

    const savedPost = await prisma.post.upsert({
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
    void queuePostAfterScrape(savedPost.id);
  }

  return { postsInspected: posts.length, newPostsSaved, knownPostsSeen };
}

interface CrawlOptions {
  maxPosts: number;
  maxScrollActions: number;
  maxDurationSeconds: number;
  consecutiveKnownLimit: number;
  delayBetweenScrollsMs: number;
  ignoreKnownPostStop?: boolean;
  useRealCursorForPermalinks?: boolean;
  realCursorMoveDurationMs?: number;
  realCursorOffsetX?: number;
  realCursorOffsetY?: number;
  permalinkProbeLimit?: number;
  permalinkProbeDwellMs?: number;
  permalinkProbePauseMs?: number;
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

    const scrollYBeforeExtraction = await page.evaluate(() => window.scrollY).catch(() => 0);
    const candidates = await extractVisiblePostsFromPage(page, groupId, canonicalGroupUrl, options.maxPosts, 0, options.shouldCancel, {
      useRealCursorForPermalinks: options.useRealCursorForPermalinks,
      realCursorMoveDurationMs: options.realCursorMoveDurationMs,
      realCursorOffsetX: options.realCursorOffsetX,
      realCursorOffsetY: options.realCursorOffsetY,
      permalinkProbeLimit: options.permalinkProbeLimit,
      permalinkProbeDwellMs: options.permalinkProbeDwellMs,
      permalinkProbePauseMs: options.permalinkProbePauseMs,
    });
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

    if (!options.ignoreKnownPostStop && consecutiveKnownPosts >= options.consecutiveKnownLimit) {
      stopReason = 'consecutive_known_posts_reached';
      break;
    }

    if (scrollActions >= options.maxScrollActions) break;

    if (options.shouldCancel?.()) {
      stopReason = 'cancelled';
      break;
    }
    const viewportHeight = await page.evaluate(() => window.innerHeight).catch(() => 900);
    await page.evaluate(({ minimumY, fallbackY }) => {
      const visiblePostBottom = [...document.querySelectorAll('[data-local-monitor-post-id]')]
        .map((node) => {
          const rect = (node as HTMLElement).getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return 0;
          if (rect.bottom <= 170 || rect.top >= window.innerHeight - 80) return 0;
          return window.scrollY + rect.bottom;
        })
        .reduce((max, bottom) => Math.max(max, bottom), 0);
      const postBottomTarget = visiblePostBottom > 0 ? visiblePostBottom - 180 : 0;
      const nextY = Math.max(window.scrollY + Math.round(window.innerHeight * 1.25), minimumY, fallbackY, postBottomTarget);
      window.scrollTo({ top: nextY, behavior: 'instant' });
    }, {
      minimumY: scrollYBeforeExtraction + Math.round(0.95 * viewportHeight),
      fallbackY: scrollYBeforeExtraction + Math.round(1.45 * viewportHeight),
    });
    scrollActions += 1;
    await options.onProgress?.({ postsInspected, newPostsSaved, knownPostsSeen, scrollActions });
    if (await sleep(options.delayBetweenScrollsMs, options.shouldCancel)) {
      stopReason = 'cancelled';
      break;
    }
  }

  await clearScraperOverlay(page);
  await options.onProgress?.({ postsInspected, newPostsSaved, knownPostsSeen, scrollActions, stopReason });
  return { postsInspected, newPostsSaved, knownPostsSeen, scrollActions, stopReason };
}

const allowedReviewStatuses = new Set<string>(reviewStatuses);

interface ListPostsOptions {
  page?: number;
  pageSize?: number;
  reviewStatus?: string;
  groupId?: string;
  search?: string;
  minConfidence?: number;
  aiReferralOnly?: boolean;
  aiIntent?: string;
  aiMemberId?: string;
}

function buildPostWhere(options: ListPostsOptions) {
  const where: {
    reviewStatus?: string;
    groupId?: string;
    extractionConfidence?: { gte: number };
    aiAssessments?: { some: Record<string, unknown> };
    OR?: Array<{ latestCapturedText?: { contains: string }; authorName?: { contains: string }; canonicalPostUrl?: { contains: string } }>;
  } = {};

  if (options.reviewStatus && options.reviewStatus !== 'all') where.reviewStatus = options.reviewStatus;
  if (options.groupId && options.groupId !== 'all') where.groupId = options.groupId;
  if (typeof options.minConfidence === 'number' && Number.isFinite(options.minConfidence) && options.minConfidence > 0) {
    where.extractionConfidence = { gte: Math.min(1, Math.max(0, options.minConfidence)) };
  }
  const aiFilter: Record<string, unknown> = {};
  if (options.aiReferralOnly) aiFilter.isReferralOpportunity = true;
  if (options.aiIntent && options.aiIntent !== 'all') aiFilter.intent = options.aiIntent;
  if (options.aiMemberId && options.aiMemberId !== 'all') {
    aiFilter.memberMatches = { some: { referralMemberId: options.aiMemberId } };
  } else if (options.aiReferralOnly) {
    aiFilter.memberMatches = { some: {} };
  }
  if (Object.keys(aiFilter).length > 0) {
    where.aiAssessments = { some: { status: 'completed', ...aiFilter } };
  }
  if (options.search?.trim()) {
    const term = options.search.trim();
    where.OR = [
      { latestCapturedText: { contains: term } },
      { authorName: { contains: term } },
      { canonicalPostUrl: { contains: term } },
    ];
  }

  return where;
}

export async function listPosts(options: ListPostsOptions = {}) {
  const page = Math.max(1, Number(options.page ?? 1));
  const pageSize = Math.max(1, Math.min(100, Number(options.pageSize ?? 25)));
  const skip = (page - 1) * pageSize;
  const where = buildPostWhere(options);
  const [items, total, all, newCount, requiresReview, useful, ignored] = await Promise.all([
    prisma.post.findMany({
      where,
      orderBy: { firstDiscoveredAt: 'desc' },
      skip,
      take: pageSize,
      include: {
        group: { select: { friendlyName: true } },
        aiAssessments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            intent: true,
            isReferralOpportunity: true,
            confidence: true,
            summary: true,
            errorMessage: true,
            createdAt: true,
            completedAt: true,
            memberMatches: {
              orderBy: { score: 'desc' },
              select: {
                id: true,
                score: true,
                scorePercent: true,
                reason: true,
                suggestedIntro: true,
                status: true,
                referralMember: {
                  select: {
                    id: true,
                    name: true,
                    businessName: true,
                    facebookName: true,
                    facebookProfileUrl: true,
                    category: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.post.count({ where }),
    prisma.post.count(),
    prisma.post.count({ where: { reviewStatus: 'new' } }),
    prisma.post.count({ where: { reviewStatus: 'requires_review' } }),
    prisma.post.count({ where: { reviewStatus: 'useful' } }),
    prisma.post.count({ where: { reviewStatus: 'ignored' } }),
  ]);
  return {
    items,
    total,
    counts: {
      all,
      new: newCount,
      requires_review: requiresReview,
      useful,
      ignored,
    },
  };
}

export async function getPostDetail(id: string) {
  const post = await prisma.post.findUnique({
    where: { id },
    include: {
      group: true,
      referralMatches: {
        include: { referralMember: true },
        orderBy: { createdAt: 'desc' },
      },
      aiAssessments: {
        orderBy: { createdAt: 'desc' },
        include: { memberMatches: { include: { referralMember: true }, orderBy: { score: 'desc' } } },
      },
    },
  });
  if (!post) throw new Error('Post not found.');
  return { post };
}

export async function updatePostReviewStatus(id: string, reviewStatus: string) {
  if (!allowedReviewStatuses.has(reviewStatus)) throw new Error(`Invalid review status: ${reviewStatus}`);
  return prisma.post.update({ where: { id }, data: { reviewStatus } });
}

export async function deleteIgnoredPosts() {
  return prisma.post.deleteMany({ where: { reviewStatus: 'ignored' } });
}

export async function deletePost(id: string) {
  return prisma.post.delete({ where: { id } });
}
