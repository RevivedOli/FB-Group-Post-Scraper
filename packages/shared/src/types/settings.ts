import type { AiProviderId } from './ai.js';

export interface AppSettings {
  browser: {
    chromeChannel: string;
    profileDirectory?: string;
    headed: boolean;
    pageLoadTimeoutMs: number;
    saveScreenshotsOnError: boolean;
    saveTracesOnFailure: boolean;
    useRealCursorForPermalinks: boolean;
    realCursorMoveDurationMs: number;
    realCursorOffsetX: number;
    realCursorOffsetY: number;
    permalinkProbeLimit: number;
    permalinkProbeDwellMs: number;
    permalinkProbePauseMs: number;
  };
  monitoring: {
    delayBetweenGroupsSeconds: number;
    delayBetweenGroupsVariationPercent: number;
    delayBetweenScrollsSeconds: number;
    delayBetweenScrollsVariationPercent: number;
    baselineMaxPosts: number;
    baselineMaxPostAgeDays: number;
    incrementalConsecutiveKnownPosts: number;
    baselineMaxGroupDurationSeconds: number;
    incrementalMaxGroupDurationSeconds: number;
  };
  ai: {
    enabled: boolean;
    autoAnalyse: boolean;
    autoStartOllama: boolean;
    provider: AiProviderId;
    ollamaBaseUrl: string;
    ollamaModel: string;
    openaiModel: string;
    openaiCustomModel: string;
    openaiCustomInputCostPerMillion: number;
    openaiCustomCachedInputCostPerMillion: number;
    openaiCustomOutputCostPerMillion: number;
    xaiModel: string;
    xaiCustomModel: string;
    xaiCustomInputCostPerMillion: number;
    xaiCustomCachedInputCostPerMillion: number;
    xaiCustomOutputCostPerMillion: number;
    customProviderLabel: string;
    customBaseUrl: string;
    customModel: string;
    customInputCostPerMillion: number;
    customCachedInputCostPerMillion: number;
    customOutputCostPerMillion: number;
    minExtractionConfidence: number;
    requireRealFacebookPermalink: boolean;
    minMatchPercent: number;
    staleRunningSeconds: number;
    requestTimeoutSeconds: number;
    /** Concurrent remote API assessments. Local Ollama always runs at 1. */
    remoteConcurrency: number;
    /** When true, posts must match at least one pre-filter phrase before AI queueing. */
    prefilterEnabled: boolean;
    /** Newline or comma separated phrases such as "looking for" or "can anyone". */
    prefilterPhrases: string;
    /** @deprecated Prefer requestTimeoutSeconds. Kept for older settings JSON. */
    ollamaRequestTimeoutSeconds?: number;
    promptTemplate: string;
  };
  ui: {
    theme: 'system' | 'light' | 'dark';
  };
}
