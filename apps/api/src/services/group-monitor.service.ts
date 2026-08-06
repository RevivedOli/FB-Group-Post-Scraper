import type { Page } from 'playwright-core';
import { prisma } from '../db/prisma.js';
import { navigateManagedPage } from './browser-session.service.js';
import { crawlAndSaveVisiblePosts, getExtractionDiagnostics } from './posts.service.js';
import { getSettings } from './settings.service.js';

export type GroupAccessStatus = 'accessible' | 'login_required' | 'unavailable' | 'unknown';

export interface GroupAccessResult {
  groupId: string;
  status: GroupAccessStatus;
  currentUrl: string;
  checkedAt: string;
  message: string;
  errorCode?: string;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function pageTextSample(page: Page) {
  return page
    .locator('body')
    .innerText({ timeout: 5000 })
    .then((text) => text.slice(0, 5000).toLowerCase())
    .catch(() => '');
}

async function classifyGroupPage(page: Page): Promise<{ status: GroupAccessStatus; message: string; errorCode?: string }> {
  const url = page.url();
  const text = await pageTextSample(page);
  const loginFields = await page
    .locator('input[name="email"], input[name="pass"], form[action*="login"]')
    .count()
    .catch(() => 0);

  if (url.includes('/login') || loginFields > 0) {
    return { status: 'login_required', message: 'Facebook login is required before this group can be checked.', errorCode: 'LOGIN_REQUIRED' };
  }

  if (
    text.includes('this content isn') ||
    text.includes('content isn') ||
    text.includes('page isn') ||
    text.includes('this page isn') ||
    text.includes('not available') ||
    text.includes('private group')
  ) {
    return { status: 'unavailable', message: 'Facebook did not show an accessible group page.', errorCode: 'GROUP_UNAVAILABLE' };
  }

  if (url.includes('facebook.com/groups/')) {
    return { status: 'accessible', message: 'The group page opened with the current browser profile.' };
  }

  return { status: 'unknown', message: 'The browser opened Facebook, but the group access state was not clear.', errorCode: 'ACCESS_UNKNOWN' };
}

export async function testGroupAccess(groupId: string, options: {
  onNavigationRetry?: (info: { url: string; attempt: number; maxAttempts: number; error: string }) => void | Promise<void>;
} = {}): Promise<GroupAccessResult> {
  const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
  const checkedAt = new Date();

  try {
    const page = await navigateManagedPage(group.canonicalGroupUrl, { onRetry: options.onNavigationRetry });
    const result = await classifyGroupPage(page);
    await prisma.group.update({
      where: { id: group.id },
      data: {
        lastTestedAt: checkedAt,
        lastTestStatus: result.status,
        lastErrorCode: result.errorCode,
        lastErrorMessage: result.status === 'accessible' ? null : result.message,
      },
    });
    return { groupId: group.id, currentUrl: page.url(), checkedAt: checkedAt.toISOString(), ...result };
  } catch (error) {
    const message = errorMessage(error);
    await prisma.group.update({
      where: { id: group.id },
      data: { lastTestedAt: checkedAt, lastTestStatus: 'unknown', lastErrorCode: 'GROUP_TEST_FAILED', lastErrorMessage: message },
    });
    return { groupId: group.id, status: 'unknown', currentUrl: group.canonicalGroupUrl, checkedAt: checkedAt.toISOString(), message, errorCode: 'GROUP_TEST_FAILED' };
  }
}

export async function runSingleGroupMonitor(groupId: string) {
  const run = await prisma.scrapeRun.create({ data: { groupId, runType: 'single_group_navigation', status: 'running' } });

  try {
    const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
    const isBaselineRun = group.baselineStatus === 'never_scanned' || group.baselineStatus === 'needs_rebaseline' || group.baselineStatus === 'baseline_failed';
    if (isBaselineRun) {
      await prisma.group.update({ where: { id: groupId }, data: { baselineStatus: 'baseline_in_progress', baselineCompletedAt: null } });
    }
    const access = await testGroupAccess(groupId);
    const completedStatus = access.status === 'accessible' ? 'completed' : 'blocked';
    const warningCount = access.status === 'accessible' ? 0 : 1;
    let postsInspected = 0;
    let newPostsSaved = 0;
    let scrollActions = 0;

    await prisma.scrapeEvent.create({
      data: {
        scrapeRunId: run.id,
        level: access.status === 'accessible' ? 'info' : 'warn',
        type: 'group_access_check',
        message: access.message,
        technicalDetail: access as unknown as object,
      },
    });

    if (access.status === 'accessible') {
      const settings = await getSettings();
      const page = await navigateManagedPage(group.canonicalGroupUrl, {
        onRetry: async (info) => {
          await prisma.scrapeEvent.create({
            data: {
              scrapeRunId: run.id,
              level: 'warn',
              type: 'navigation_retry',
              message: `${group.friendlyName}: page load timed out; refreshing and retrying (attempt ${info.attempt + 1}/${info.maxAttempts}).`,
            },
          });
        },
      });
      const maxPosts = group.maxPostsPerRun ?? settings.monitoring.baselineMaxPosts;
      const maxScrollActions = group.maxScrollActions ?? 20;
      const maxDurationSeconds = group.maxGroupDurationSeconds ?? settings.monitoring.baselineMaxGroupDurationSeconds;
      const crawl = await crawlAndSaveVisiblePosts(page, group.id, group.canonicalGroupUrl, {
        maxPosts,
        maxScrollActions,
        maxDurationSeconds,
        consecutiveKnownLimit: settings.monitoring.incrementalConsecutiveKnownPosts,
        delayBetweenScrollsMs: settings.monitoring.delayBetweenScrollsSeconds * 1000,
        ignoreKnownPostStop: isBaselineRun,
        useRealCursorForPermalinks: settings.browser.useRealCursorForPermalinks,
        realCursorMoveDurationMs: settings.browser.realCursorMoveDurationMs,
        realCursorOffsetX: settings.browser.realCursorOffsetX,
        realCursorOffsetY: settings.browser.realCursorOffsetY,
        permalinkProbeLimit: settings.browser.permalinkProbeLimit,
        permalinkProbeDwellMs: settings.browser.permalinkProbeDwellMs,
        permalinkProbePauseMs: settings.browser.permalinkProbePauseMs,
        onProgress: async (progress) => {
          await prisma.scrapeRun.update({
            where: { id: run.id },
            data: {
              postsInspected: progress.postsInspected,
              newPostsSaved: progress.newPostsSaved,
              scrollActions: progress.scrollActions,
            },
          });
        },
      });
      const diagnostics = await getExtractionDiagnostics(page);
      postsInspected = crawl.postsInspected;
      newPostsSaved = crawl.newPostsSaved;
      scrollActions = crawl.scrollActions;
      await prisma.scrapeEvent.create({
        data: {
          scrapeRunId: run.id,
          level: 'info',
          type: 'posts_extracted',
          message: `Inspected ${postsInspected} visible post(s), saved ${newPostsSaved} new post(s), and scrolled ${scrollActions} time(s).`,
          technicalDetail: { ...crawl, diagnostics } as unknown as object,
        },
      });
    }

    const completedRun = await prisma.scrapeRun.update({
      where: { id: run.id },
      data: {
        status: completedStatus,
        completedAt: new Date(),
        groupsCompleted: 1,
        postsInspected,
        newPostsSaved,
        scrollActions,
        warningCount,
        errorCode: access.errorCode,
        errorMessage: access.status === 'accessible' ? null : access.message,
      },
    });
    if (access.status === 'accessible') {
      const completedAt = new Date();
      await prisma.group.update({
        where: { id: groupId },
        data: {
          lastSuccessfulMonitorAt: completedAt,
          ...(isBaselineRun ? { baselineStatus: 'baseline_completed', baselineCompletedAt: completedAt } : {}),
        },
      });
    } else if (isBaselineRun) {
      await prisma.group.update({ where: { id: groupId }, data: { baselineStatus: 'baseline_failed' } });
    }
    return { run: completedRun, access, postsInspected, newPostsSaved };
  } catch (error) {
    const message = errorMessage(error);
    const failedRun = await prisma.scrapeRun.update({
      where: { id: run.id },
      data: { status: 'failed', completedAt: new Date(), errorCode: 'SINGLE_GROUP_RUN_FAILED', errorMessage: message },
    });
    await prisma.scrapeEvent.create({
      data: { scrapeRunId: run.id, level: 'error', type: 'single_group_run_failed', message, technicalDetail: { groupId } },
    });
    await prisma.group.update({ where: { id: groupId }, data: { baselineStatus: 'baseline_failed', lastErrorCode: 'SINGLE_GROUP_RUN_FAILED', lastErrorMessage: message } }).catch(() => undefined);
    return { run: failedRun, postsInspected: 0, newPostsSaved: 0 };
  }
}
