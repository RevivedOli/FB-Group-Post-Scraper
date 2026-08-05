import type { AppSettings } from '@local-group-monitor/shared';
import { prisma } from '../db/prisma.js';

export const defaultAiPromptTemplate = `You assess local Facebook group posts for BNI referral opportunities.

Return strict JSON only. Do not include markdown.

Classify the post:
- looking_for_help: the author is asking for a recommendation, supplier, service, product, venue, advice, or help.
- advertising: the author is promoting their own business, event, product, job, service, or offer.
- discussion: general chat, thanks, questions with no service need, or community discussion.
- irrelevant: spam, unclear, duplicate, or too little context.

Use the BNI member profiles to decide who could realistically help. Give 0% when there is no useful fit. Prefer precise matches over broad weak matches.

JSON shape:
{
  "intent": "looking_for_help | advertising | discussion | irrelevant",
  "isReferralOpportunity": true,
  "confidence": 0.92,
  "summary": "Short plain-English summary.",
  "recommendedMembers": [
    {
      "memberId": "member id from input",
      "scorePercent": "85%",
      "reason": "Why this member fits the request.",
      "suggestedIntro": "Optional short intro message."
    }
  ]
}`;

export const defaultSettings: AppSettings = {
  browser:{ chromeChannel:'chrome', headed:true, pageLoadTimeoutMs:30000, saveScreenshotsOnError:true, saveTracesOnFailure:true, useRealCursorForPermalinks:false, realCursorMoveDurationMs:450, realCursorOffsetX:0, realCursorOffsetY:0, permalinkProbeLimit:2, permalinkProbeDwellMs:700, permalinkProbePauseMs:250 },
  monitoring:{ delayBetweenGroupsSeconds:10, delayBetweenGroupsVariationPercent:20, delayBetweenScrollsSeconds:5, delayBetweenScrollsVariationPercent:20, baselineMaxPosts:100, baselineMaxPostAgeDays:7, incrementalConsecutiveKnownPosts:5, baselineMaxGroupDurationSeconds:300, incrementalMaxGroupDurationSeconds:120 },
  ai:{ enabled:true, autoAnalyse:true, autoStartOllama:true, provider:'ollama', ollamaBaseUrl:'http://127.0.0.1:11434', ollamaModel:'qwen3:4b-instruct', openaiModel:'gpt-5.6-luna', openaiCustomModel:'', xaiModel:'grok-4.5', xaiCustomModel:'', customProviderLabel:'Custom compatible API', customBaseUrl:'', customModel:'', customInputCostPerMillion:0, customOutputCostPerMillion:0, minExtractionConfidence:0.8, requireRealFacebookPermalink:true, minMatchPercent:20, staleRunningSeconds:300, ollamaRequestTimeoutSeconds:180, promptTemplate:defaultAiPromptTemplate },
  ui:{ theme:'system' },
};

function normalizeSettings(value: unknown): AppSettings {
  const partial = (value ?? {}) as Partial<AppSettings>;
  return {
    browser: { ...defaultSettings.browser, ...(partial.browser ?? {}) },
    monitoring: { ...defaultSettings.monitoring, ...(partial.monitoring ?? {}) },
    ai: { ...defaultSettings.ai, ...(partial.ai ?? {}) },
    ui: { ...defaultSettings.ui, ...(partial.ui ?? {}) },
  };
}

export async function getSettings(): Promise<AppSettings>{ const row = await prisma.setting.findUnique({where:{key:'app'}}); return normalizeSettings(row?.value); }
export async function updateSettings(value: unknown): Promise<AppSettings>{ const next = normalizeSettings(value); return (await prisma.setting.upsert({where:{key:'app'},create:{key:'app',value:next as unknown as object},update:{value:next as unknown as object}})).value as unknown as AppSettings; }
