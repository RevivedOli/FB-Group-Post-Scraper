export type AiProviderId = 'ollama' | 'openai' | 'xai' | 'custom';

export interface AiModelPricing {
  inputCostPerMillion: number;
  cachedInputCostPerMillion: number;
  outputCostPerMillion: number;
}

export interface AiCuratedModel extends AiModelPricing {
  id: string;
  label: string;
  provider: Exclude<AiProviderId, 'ollama' | 'custom'>;
  description: string;
  recommended?: boolean;
}

export interface AiPricingSnapshot extends AiModelPricing {
  catalogVersion: string;
  provider: AiProviderId;
  providerLabel: string;
  model: string;
  baseUrl?: string;
  estimated: boolean;
}

export interface AiCredentialStatus {
  openai: boolean;
  xai: boolean;
  custom: boolean;
}

export interface AiProviderHealth {
  provider: AiProviderId;
  providerLabel: string;
  model: string;
  baseUrl?: string;
  reachable: boolean;
  hasApiKey?: boolean;
  detail: string;
}

export interface AiUsageTotals {
  requestCount: number;
  assessmentCount: number;
  completedCount: number;
  failedCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  averageLatencyMs: number | null;
}

export interface AiUsageByProviderModel extends AiUsageTotals {
  provider: string;
  providerLabel: string;
  model: string;
}

export interface AiUsageByDay extends AiUsageTotals {
  date: string;
}

export interface AiUsageReport {
  from: string;
  to: string;
  totals: AiUsageTotals;
  byProviderModel: AiUsageByProviderModel[];
  byDay: AiUsageByDay[];
}

export interface AiAssessmentSummary {
  id: string;
  status: string;
  intent?: string | null;
  isReferralOpportunity?: boolean | null;
  confidence?: number | null;
  summary?: string | null;
  errorMessage?: string | null;
  model?: string | null;
  provider?: string | null;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  requestCount?: number | null;
  estimatedCostUsd?: number | null;
  durationMs?: number | null;
  pricingSnapshot?: AiPricingSnapshot | null;
  promptVersion?: string | null;
  promptText?: string | null;
  renderedPrompt?: string | null;
  inputPayload?: unknown;
  rawResponse?: unknown;
  parsed?: unknown;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface AiStatus {
  enabled: boolean;
  autoAnalyse: boolean;
  provider: AiProviderId;
  providerLabel: string;
  model: string;
  baseUrl?: string;
  ollamaBaseUrl: string;
  ollamaReachable: boolean;
  providerHealth: AiProviderHealth;
  counts: Record<string, number>;
  processorRunning: boolean;
  processorStartedAt?: string | Date | null;
  currentAssessmentId?: string | null;
  currentPostUrl?: string | null;
  currentAssessmentIds?: string[];
  currentPostUrls?: string[];
  activeJobCount?: number;
  remoteConcurrency: number;
  effectiveConcurrency: number;
  processedInCurrentRun?: number;
  promptVersion: string;
  oldestRunningStartedAt?: string | Date | null;
  staleRunningThresholdSeconds: number;
  prefilterEnabled?: boolean;
}
