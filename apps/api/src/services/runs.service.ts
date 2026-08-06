import { prisma } from '../db/prisma.js';
import { testGroupAccess } from './group-monitor.service.js';
import { navigateManagedPage } from './browser-session.service.js';
import { crawlAndSaveVisiblePosts, getExtractionDiagnostics } from './posts.service.js';
import { getSettings } from './settings.service.js';

let activeRun: { id: string; cancelled: boolean } | undefined;

export type RunGroupsMode = 'all' | 'remaining';

/** Most recent full "run all" campaign — remaining runs keep this cutoff so resume can chain. */
async function getLastAllEnabledRun() {
  return prisma.scrapeRun.findFirst({
    where: { runType: 'all_enabled_group_access' },
    orderBy: { startedAt: 'desc' },
  });
}

/**
 * Enabled groups not successfully finished since the last "Run all" started.
 * Remaining/resume runs do not change this cutoff, so chained resumes keep working.
 */
export async function listRemainingEnabledGroups() {
  const lastAllRun = await getLastAllEnabledRun();
  const cutoff = lastAllRun?.startedAt;
  return prisma.group.findMany({
    where: {
      enabled: true,
      OR: cutoff
        ? [{ lastSuccessfulMonitorAt: null }, { lastSuccessfulMonitorAt: { lt: cutoff } }]
        : [{ lastSuccessfulMonitorAt: null }],
    },
    orderBy: { displayOrder: 'asc' },
  });
}

export async function getRunStartOptions() {
  const [enabledGroups, remainingGroups, lastAllRun] = await Promise.all([
    prisma.group.findMany({
      where: { enabled: true },
      orderBy: { displayOrder: 'asc' },
      select: { id: true, friendlyName: true },
    }),
    listRemainingEnabledGroups(),
    getLastAllEnabledRun(),
  ]);
  return {
    enabledCount: enabledGroups.length,
    remainingCount: remainingGroups.length,
    remainingGroups: remainingGroups.map((group) => ({ id: group.id, friendlyName: group.friendlyName })),
    lastAllRunStatus: lastAllRun?.status ?? null,
    lastAllRunGroupsCompleted: lastAllRun?.groupsCompleted ?? 0,
    lastAllRunStartedAt: lastAllRun?.startedAt.toISOString() ?? null,
  };
}

async function getRunGroupsTarget(runId: string, fallback: number) {
  const started = await prisma.scrapeEvent.findFirst({
    where: { scrapeRunId: runId, type: 'run_started' },
    orderBy: { createdAt: 'asc' },
    select: { message: true, technicalDetail: true },
  });
  const detail = started?.technicalDetail as { groupsTarget?: number } | null | undefined;
  if (typeof detail?.groupsTarget === 'number' && detail.groupsTarget > 0) {
    return detail.groupsTarget;
  }
  const match = started?.message.match(/\((\d+)\)/);
  if (match) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

export async function getRunSummary() {
  const [lastRun, enabledGroups, remainingGroups] = await Promise.all([
    prisma.scrapeRun.findFirst({ orderBy: { createdAt: 'desc' } }),
    prisma.group.count({ where: { enabled: true } }),
    listRemainingEnabledGroups(),
  ]);

  if (!lastRun) {
    return {
      runStatus: 'Not started',
      currentGroup: 'Not started',
      groupsCompleted: 0,
      totalGroups: enabledGroups,
      remainingGroups: remainingGroups.length,
      postsInspected: 0,
      newPostsSaved: 0,
      scrollActions: 0,
      warnings: 0,
    };
  }

  const totalGroups = await getRunGroupsTarget(lastRun.id, enabledGroups);

  return {
    runStatus: lastRun.status,
    currentGroup: lastRun.status === 'running' ? await getCurrentRunGroupLabel(lastRun.id) : 'Idle',
    groupsCompleted: lastRun.groupsCompleted,
    totalGroups,
    remainingGroups: remainingGroups.length,
    postsInspected: lastRun.postsInspected,
    newPostsSaved: lastRun.newPostsSaved,
    scrollActions: lastRun.scrollActions,
    warnings: lastRun.warningCount,
    lastRunId: lastRun.id,
    lastRunStartedAt: lastRun.startedAt.toISOString(),
    lastRunCompletedAt: lastRun.completedAt?.toISOString(),
  };
}

async function getCurrentRunGroupLabel(runId: string) {
  const event = await prisma.scrapeEvent.findFirst({
    where: { scrapeRunId: runId, type: 'group_started' },
    orderBy: { createdAt: 'desc' },
  });
  return event?.message.replace(/^Checking /, '') ?? 'Checking groups';
}

export async function listRunEvents(limit = 25) {
  return prisma.scrapeEvent.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, scrapeRunId: true, level: true, type: true, message: true, createdAt: true },
  });
}

export async function recoverOrphanedScrapeRuns() {
  const orphans = await prisma.scrapeRun.findMany({
    where: {
      status: 'running',
      ...(activeRun ? { id: { not: activeRun.id } } : {}),
    },
  });
  if (orphans.length === 0) return { recovered: 0 };

  const completedAt = new Date();
  const message = 'Run interrupted because the API process restarted. The browser session was closed with it.';
  await prisma.$transaction([
    ...orphans.map((run) => prisma.scrapeRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        completedAt,
        errorCode: 'RUN_INTERRUPTED',
        errorMessage: message,
      },
    })),
    ...orphans.map((run) => prisma.scrapeEvent.create({
      data: {
        scrapeRunId: run.id,
        level: 'error',
        type: 'run_interrupted',
        message,
      },
    })),
  ]);
  return { recovered: orphans.length };
}

export async function cancelActiveRun() {
  if (activeRun) {
    activeRun.cancelled = true;
    await prisma.scrapeEvent.create({
      data: { scrapeRunId: activeRun.id, level: 'warn', type: 'run_cancel_requested', message: 'Cancel requested by user.' },
    });
    return { cancelled: true, runId: activeRun.id };
  }

  // After an API restart the in-memory worker is gone but the DB row can still say running.
  const orphaned = await prisma.scrapeRun.findMany({ where: { status: 'running' }, orderBy: { createdAt: 'desc' } });
  if (orphaned.length === 0) return { cancelled: false, message: 'No run is active.' };

  const completedAt = new Date();
  await prisma.$transaction([
    ...orphaned.map((run) => prisma.scrapeRun.update({
      where: { id: run.id },
      data: {
        status: 'cancelled',
        completedAt,
        errorCode: 'RUN_CANCELLED',
        errorMessage: 'Cancelled after the scrape worker was no longer active (likely after an API restart).',
      },
    })),
    ...orphaned.map((run) => prisma.scrapeEvent.create({
      data: {
        scrapeRunId: run.id,
        level: 'warn',
        type: 'run_cancelled',
        message: 'Cancelled stale run that was no longer active in this API process.',
      },
    })),
  ]);
  return { cancelled: true, runId: orphaned[0].id, recovered: orphaned.length };
}

export async function runEnabledGroups(options: { mode?: RunGroupsMode } = {}) {
  if (activeRun) return { run: await prisma.scrapeRun.findUnique({ where: { id: activeRun.id } }), groups: [], alreadyRunning: true };
  await recoverOrphanedScrapeRuns();

  const mode: RunGroupsMode = options.mode === 'remaining' ? 'remaining' : 'all';
  const groups = mode === 'remaining'
    ? await listRemainingEnabledGroups()
    : await prisma.group.findMany({ where: { enabled: true }, orderBy: { displayOrder: 'asc' } });

  if (mode === 'remaining' && groups.length === 0) {
    throw new Error('No incomplete enabled groups to run. Choose “Run all enabled groups” instead.');
  }

  const run = await prisma.scrapeRun.create({
    data: {
      runType: mode === 'remaining' ? 'remaining_enabled_group_access' : 'all_enabled_group_access',
      status: 'running',
    },
  });
  activeRun = { id: run.id, cancelled: false };

  await prisma.scrapeEvent.create({
    data: {
      scrapeRunId: run.id,
      level: 'info',
      type: 'run_started',
      message: mode === 'remaining'
        ? `Starting remaining incomplete groups (${groups.length}).`
        : `Starting all enabled groups (${groups.length}).`,
      technicalDetail: {
        mode,
        groupsTarget: groups.length,
        groupIds: groups.map((group) => group.id),
      },
    },
  });

  void processEnabledGroupsRun(run.id, groups).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.scrapeRun.update({
      where: { id: run.id },
      data: { status: 'failed', completedAt: new Date(), errorCode: 'RUN_FAILED', errorMessage: message },
    });
    await prisma.scrapeEvent.create({
      data: { scrapeRunId: run.id, level: 'error', type: 'run_failed', message },
    });
    activeRun = undefined;
  });

  return { run, mode, groups: groups.map((group) => ({ id: group.id, friendlyName: group.friendlyName })) };
}

async function processEnabledGroupsRun(runId: string, groups: Awaited<ReturnType<typeof prisma.group.findMany>>) {
  if (groups.length === 0) {
    await prisma.scrapeEvent.create({
      data: { scrapeRunId: runId, level: 'warn', type: 'no_enabled_groups', message: 'No enabled groups are configured.' },
    });
    await prisma.scrapeRun.update({
      where: { id: runId },
      data: { status: 'completed', completedAt: new Date(), warningCount: 1 },
    });
    activeRun = undefined;
    return;
  }

  let groupsCompleted = 0;
  let postsInspected = 0;
  let newPostsSaved = 0;
  let scrollActions = 0;
  let warningCount = 0;
  let errorCode: string | undefined;
  let errorMessage: string | undefined;
  const results = [];

  for (const group of groups) {
    if (activeRun?.id === runId && activeRun.cancelled) break;
    const isBaselineRun = group.baselineStatus === 'never_scanned' || group.baselineStatus === 'needs_rebaseline' || group.baselineStatus === 'baseline_failed';
    if (isBaselineRun) {
      await prisma.group.update({ where: { id: group.id }, data: { baselineStatus: 'baseline_in_progress', baselineCompletedAt: null } });
    }

    await prisma.scrapeEvent.create({
      data: { scrapeRunId: runId, level: 'info', type: 'group_started', message: `Checking ${group.friendlyName}` },
    });

    const logNavigationRetry = async (info: { attempt: number; maxAttempts: number }) => {
      await prisma.scrapeEvent.create({
        data: {
          scrapeRunId: runId,
          level: 'warn',
          type: 'navigation_retry',
          message: `${group.friendlyName}: page load timed out; refreshing and retrying (attempt ${info.attempt + 1}/${info.maxAttempts}).`,
        },
      });
    };

    try {
      const access = await testGroupAccess(group.id, { onNavigationRetry: logNavigationRetry });
      groupsCompleted += 1;
      if (access.status !== 'accessible') {
        warningCount += 1;
        errorCode = access.errorCode;
        errorMessage = access.message;
        if (isBaselineRun) {
          await prisma.group.update({ where: { id: group.id }, data: { baselineStatus: 'baseline_failed' } });
        }
      } else {
        const settings = await getSettings();
        const page = await navigateManagedPage(group.canonicalGroupUrl, { onRetry: logNavigationRetry });
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
          shouldCancel: () => activeRun?.id === runId && activeRun.cancelled,
          onProgress: async (progress) => {
            await prisma.scrapeRun.update({
              where: { id: runId },
              data: {
                postsInspected: postsInspected + progress.postsInspected,
                newPostsSaved: newPostsSaved + progress.newPostsSaved,
                scrollActions: scrollActions + progress.scrollActions,
              },
            });
          },
        });
        const diagnostics = await getExtractionDiagnostics(page);
        postsInspected += crawl.postsInspected;
        newPostsSaved += crawl.newPostsSaved;
        scrollActions += crawl.scrollActions;
        const completedAt = new Date();
        await prisma.group.update({
          where: { id: group.id },
          data: {
            lastSuccessfulMonitorAt: completedAt,
            ...(isBaselineRun ? { baselineStatus: 'baseline_completed', baselineCompletedAt: completedAt } : {}),
          },
        });
        await prisma.scrapeEvent.create({
          data: {
            scrapeRunId: runId,
            level: 'info',
            type: 'posts_extracted',
            message: `${group.friendlyName}: inspected ${crawl.postsInspected} visible post(s), saved ${crawl.newPostsSaved} new post(s), and scrolled ${crawl.scrollActions} time(s).`,
            technicalDetail: { ...crawl, diagnostics } as unknown as object,
          },
        });
      }

      await prisma.scrapeEvent.create({
        data: {
          scrapeRunId: runId,
          level: access.status === 'accessible' ? 'info' : 'warn',
          type: 'group_access_check',
          message: `${group.friendlyName}: ${access.message}`,
          technicalDetail: access as unknown as object,
        },
      });
      results.push({ group, access });
    } catch (error) {
      groupsCompleted += 1;
      warningCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      errorCode = 'GROUP_NAVIGATION_FAILED';
      errorMessage = message;
      if (isBaselineRun) {
        await prisma.group.update({ where: { id: group.id }, data: { baselineStatus: 'baseline_failed' } }).catch(() => undefined);
      }
      await prisma.scrapeEvent.create({
        data: {
          scrapeRunId: runId,
          level: 'error',
          type: 'group_navigation_failed',
          message: `${group.friendlyName}: ${message}`,
        },
      });
      results.push({ group, access: { status: 'unknown', message } });
    }

    await prisma.scrapeRun.update({
      where: { id: runId },
      data: { groupsCompleted, postsInspected, newPostsSaved, warningCount, errorCode, errorMessage },
    });
  }

  const wasCancelled = activeRun?.id === runId && activeRun.cancelled;
  await prisma.scrapeRun.update({
    where: { id: runId },
    data: {
      status: wasCancelled ? 'cancelled' : warningCount > 0 ? 'completed_with_warnings' : 'completed',
      completedAt: new Date(),
      groupsCompleted,
      postsInspected,
      newPostsSaved,
      scrollActions,
      warningCount,
      errorCode,
      errorMessage,
    },
  });
  await prisma.scrapeEvent.create({
    data: {
      scrapeRunId: runId,
      level: wasCancelled || warningCount > 0 ? 'warn' : 'info',
      type: wasCancelled ? 'run_cancelled' : 'run_completed',
      message: `${wasCancelled ? 'Cancelled after' : 'Completed'} ${groupsCompleted} group checks, inspected ${postsInspected} post(s), and saved ${newPostsSaved} new post(s).`,
    },
  });

  activeRun = undefined;
}
