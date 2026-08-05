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
    provider: 'ollama' | 'openai' | 'xai' | 'custom';
    ollamaBaseUrl: string;
    ollamaModel: string;
    openaiModel: string;
    openaiCustomModel: string;
    xaiModel: string;
    xaiCustomModel: string;
    customProviderLabel: string;
    customBaseUrl: string;
    customModel: string;
    customInputCostPerMillion: number;
    customOutputCostPerMillion: number;
    minExtractionConfidence: number;
    requireRealFacebookPermalink: boolean;
    minMatchPercent: number;
    staleRunningSeconds: number;
    ollamaRequestTimeoutSeconds: number;
    promptTemplate: string;
  };
  ui: {
    theme: 'system' | 'light' | 'dark';
  };
}
