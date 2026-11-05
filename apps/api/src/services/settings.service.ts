import type { AppSettings, AiProviderId } from '@local-group-monitor/shared';
import { DEFAULT_AI_PREFILTER_PHRASES } from '@local-group-monitor/shared';
import { prisma } from '../db/prisma.js';

export const defaultAiPromptTemplate = `You assess local Facebook group posts for BNI referral opportunities.

Return strict JSON only. Do not include markdown.

Classify the post:
- looking_for_help: the author is asking for a recommendation, supplier, service, product, venue, advice, or help.
- advertising: the author is promoting their own business, event, product, job, service, or offer.
- discussion: general chat, thanks, questions with no service need, or community discussion.
- irrelevant: spam, unclear, duplicate, or too little context.

Use the BNI member profiles to decide who could realistically help. Give 0% when there is no useful fit. Prefer precise matches over broad weak matches.

Only recommend members using an exact memberId from the supplied referralMembers list. Never invent member IDs or match by display name alone. If no member genuinely fits, return an empty recommendedMembers array and isReferralOpportunity false.

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

const PROVIDERS = new Set<AiProviderId>(['ollama', 'openai', 'xai', 'custom']);

function asNumber(value: unknown, fallback: number) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asNonNegative(value: unknown, fallback: number) {
  return Math.max(0, asNumber(value, fallback));
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function asString(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback;
}

function asProvider(value: unknown): AiProviderId {
  return PROVIDERS.has(value as AiProviderId) ? value as AiProviderId : 'ollama';
}

export const defaultSettings: AppSettings = {
  browser: {
    chromeChannel: 'chrome',
    headed: true,
    pageLoadTimeoutMs: 30000,
    saveScreenshotsOnError: true,
    saveTracesOnFailure: true,
    useRealCursorForPermalinks: false,
    realCursorMoveDurationMs: 450,
    realCursorOffsetX: 0,
    realCursorOffsetY: 0,
    permalinkProbeLimit: 2,
    permalinkProbeDwellMs: 700,
    permalinkProbePauseMs: 250,
  },
  monitoring: {
    delayBetweenGroupsSeconds: 10,
    delayBetweenGroupsVariationPercent: 20,
    delayBetweenScrollsSeconds: 5,
    delayBetweenScrollsVariationPercent: 20,
    baselineMaxPosts: 100,
    baselineMaxPostAgeDays: 7,
    incrementalConsecutiveKnownPosts: 5,
    baselineMaxGroupDurationSeconds: 300,
    incrementalMaxGroupDurationSeconds: 120,
  },
  ai: {
    enabled: true,
    autoAnalyse: true,
    autoStartOllama: true,
    provider: 'ollama',
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'qwen3:4b-instruct',
    openaiModel: 'gpt-6-luna',
    openaiCustomModel: '',
    openaiCustomInputCostPerMillion: 0,
    openaiCustomCachedInputCostPerMillion: 0,
    openaiCustomOutputCostPerMillion: 0,
    xaiModel: 'grok-4.5',
    xaiCustomModel: '',
    xaiCustomInputCostPerMillion: 0,
    xaiCustomCachedInputCostPerMillion: 0,
    xaiCustomOutputCostPerMillion: 0,
    customProviderLabel: 'Custom compatible API',
    customBaseUrl: '',
    customModel: '',
    customInputCostPerMillion: 0,
    customCachedInputCostPerMillion: 0,
    customOutputCostPerMillion: 0,
    minExtractionConfidence: 0.8,
    // Navigation preference only — hash-fallback posts still go through the AI prefilter.
    requireRealFacebookPermalink: false,
    minMatchPercent: 20,
    staleRunningSeconds: 300,
    requestTimeoutSeconds: 180,
    remoteConcurrency: 5,
    prefilterEnabled: true,
    prefilterPhrases: DEFAULT_AI_PREFILTER_PHRASES,
    promptTemplate: defaultAiPromptTemplate,
  },
  ui: { theme: 'system' },
};

function normalizeAi(partial: Partial<AppSettings['ai']> | undefined): AppSettings['ai'] {
  const input = partial ?? {};
  const merged = { ...defaultSettings.ai, ...input };
  const requestTimeoutSeconds = Math.max(
    30,
    asNumber(
      input.requestTimeoutSeconds
        ?? input.ollamaRequestTimeoutSeconds
        ?? merged.requestTimeoutSeconds,
      defaultSettings.ai.requestTimeoutSeconds,
    ),
  );
  return {
    enabled: asBoolean(merged.enabled, defaultSettings.ai.enabled),
    autoAnalyse: asBoolean(merged.autoAnalyse, defaultSettings.ai.autoAnalyse),
    autoStartOllama: asBoolean(merged.autoStartOllama, defaultSettings.ai.autoStartOllama),
    provider: asProvider(merged.provider),
    ollamaBaseUrl: asString(merged.ollamaBaseUrl, defaultSettings.ai.ollamaBaseUrl).replace(/\/$/, ''),
    ollamaModel: asString(merged.ollamaModel, defaultSettings.ai.ollamaModel).trim(),
    openaiModel: asString(merged.openaiModel, defaultSettings.ai.openaiModel).trim() || defaultSettings.ai.openaiModel,
    openaiCustomModel: asString(merged.openaiCustomModel, '').trim(),
    openaiCustomInputCostPerMillion: asNonNegative(merged.openaiCustomInputCostPerMillion, 0),
    openaiCustomCachedInputCostPerMillion: asNonNegative(merged.openaiCustomCachedInputCostPerMillion, 0),
    openaiCustomOutputCostPerMillion: asNonNegative(merged.openaiCustomOutputCostPerMillion, 0),
    xaiModel: asString(merged.xaiModel, defaultSettings.ai.xaiModel).trim() || defaultSettings.ai.xaiModel,
    xaiCustomModel: asString(merged.xaiCustomModel, '').trim(),
    xaiCustomInputCostPerMillion: asNonNegative(merged.xaiCustomInputCostPerMillion, 0),
    xaiCustomCachedInputCostPerMillion: asNonNegative(merged.xaiCustomCachedInputCostPerMillion, 0),
    xaiCustomOutputCostPerMillion: asNonNegative(merged.xaiCustomOutputCostPerMillion, 0),
    customProviderLabel: asString(merged.customProviderLabel, defaultSettings.ai.customProviderLabel).trim() || defaultSettings.ai.customProviderLabel,
    customBaseUrl: asString(merged.customBaseUrl, '').trim().replace(/\/$/, ''),
    customModel: asString(merged.customModel, '').trim(),
    customInputCostPerMillion: asNonNegative(merged.customInputCostPerMillion, 0),
    customCachedInputCostPerMillion: asNonNegative(merged.customCachedInputCostPerMillion, 0),
    customOutputCostPerMillion: asNonNegative(merged.customOutputCostPerMillion, 0),
    minExtractionConfidence: Math.max(0, Math.min(1, asNumber(merged.minExtractionConfidence, defaultSettings.ai.minExtractionConfidence))),
    requireRealFacebookPermalink: asBoolean(merged.requireRealFacebookPermalink, defaultSettings.ai.requireRealFacebookPermalink),
    minMatchPercent: Math.max(0, Math.min(100, asNumber(merged.minMatchPercent, defaultSettings.ai.minMatchPercent))),
    staleRunningSeconds: Math.max(30, asNumber(merged.staleRunningSeconds, defaultSettings.ai.staleRunningSeconds)),
    requestTimeoutSeconds,
    remoteConcurrency: Math.max(1, Math.min(20, Math.round(asNumber(merged.remoteConcurrency, defaultSettings.ai.remoteConcurrency)))),
    prefilterEnabled: asBoolean(merged.prefilterEnabled, defaultSettings.ai.prefilterEnabled),
    prefilterPhrases: asString(merged.prefilterPhrases, defaultSettings.ai.prefilterPhrases) || defaultSettings.ai.prefilterPhrases,
    promptTemplate: asString(merged.promptTemplate, defaultSettings.ai.promptTemplate) || defaultSettings.ai.promptTemplate,
  };
}

export function normalizeSettings(value: unknown): AppSettings {
  const partial = (value ?? {}) as Partial<AppSettings>;
  return {
    browser: { ...defaultSettings.browser, ...(partial.browser ?? {}) },
    monitoring: { ...defaultSettings.monitoring, ...(partial.monitoring ?? {}) },
    ai: normalizeAi(partial.ai),
    ui: { ...defaultSettings.ui, ...(partial.ui ?? {}) },
  };
}

export function validateAiSettings(ai: AppSettings['ai']) {
  if (ai.provider === 'ollama') {
    if (!ai.ollamaBaseUrl) throw new Error('Enter an Ollama base URL.');
    if (!ai.ollamaModel) throw new Error('Enter a local Ollama model ID.');
    return;
  }
  if (ai.provider === 'openai') {
    if (ai.openaiModel === '__custom__' && !ai.openaiCustomModel) {
      throw new Error('Enter a custom OpenAI model ID.');
    }
    return;
  }
  if (ai.provider === 'xai') {
    if (ai.xaiModel === '__custom__' && !ai.xaiCustomModel) {
      throw new Error('Enter a custom xAI model ID.');
    }
    return;
  }
  if (!ai.customBaseUrl) throw new Error('Enter a custom API base URL.');
  if (!ai.customModel) throw new Error('Enter a custom model ID.');
}

export async function getSettings(): Promise<AppSettings> {
  const row = await prisma.setting.findUnique({ where: { key: 'app' } });
  return normalizeSettings(row?.value);
}

export async function updateSettings(value: unknown): Promise<AppSettings> {
  const next = normalizeSettings(value);
  validateAiSettings(next.ai);
  return (await prisma.setting.upsert({
    where: { key: 'app' },
    create: { key: 'app', value: next as unknown as object },
    update: { value: next as unknown as object },
  })).value as unknown as AppSettings;
}
