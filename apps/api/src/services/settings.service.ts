import type { AppSettings } from '@local-group-monitor/shared';
import { prisma } from '../db/prisma.js';
export const defaultSettings: AppSettings = { browser:{ chromeChannel:'chrome', headed:true, pageLoadTimeoutMs:30000, saveScreenshotsOnError:true, saveTracesOnFailure:true, useRealCursorForPermalinks:false, realCursorMoveDurationMs:450, realCursorOffsetX:0, realCursorOffsetY:0, permalinkProbeLimit:2, permalinkProbeDwellMs:700, permalinkProbePauseMs:250 }, monitoring:{ delayBetweenGroupsSeconds:10, delayBetweenGroupsVariationPercent:20, delayBetweenScrollsSeconds:5, delayBetweenScrollsVariationPercent:20, baselineMaxPosts:100, baselineMaxPostAgeDays:7, incrementalConsecutiveKnownPosts:5, baselineMaxGroupDurationSeconds:300, incrementalMaxGroupDurationSeconds:120 }, ui:{ theme:'system' } };

function normalizeSettings(value: unknown): AppSettings {
  const partial = (value ?? {}) as Partial<AppSettings>;
  return {
    browser: { ...defaultSettings.browser, ...(partial.browser ?? {}) },
    monitoring: { ...defaultSettings.monitoring, ...(partial.monitoring ?? {}) },
    ui: { ...defaultSettings.ui, ...(partial.ui ?? {}) },
  };
}

export async function getSettings(): Promise<AppSettings>{ const row = await prisma.setting.findUnique({where:{key:'app'}}); return normalizeSettings(row?.value); }
export async function updateSettings(value: unknown): Promise<AppSettings>{ const next = normalizeSettings(value); return (await prisma.setting.upsert({where:{key:'app'},create:{key:'app',value:next as unknown as object},update:{value:next as unknown as object}})).value as unknown as AppSettings; }
