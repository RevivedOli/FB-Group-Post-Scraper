import type { AiCuratedModel, AiModelPricing, AiProviderId } from '../types/ai.js';

export const AI_PRICING_CATALOG_VERSION = '2026-08-05';

export const CUSTOM_MODEL_SENTINEL = '__custom__';

export const OPENAI_CURATED_MODELS: AiCuratedModel[] = [
  {
    id: 'gpt-5.6-luna',
    label: 'GPT-5.6 Luna',
    provider: 'openai',
    description: 'Efficient default for high-volume classification and matching',
    recommended: true,
    inputCostPerMillion: 0.2,
    cachedInputCostPerMillion: 0.02,
    outputCostPerMillion: 1.2,
  },
  {
    id: 'gpt-5.4-nano',
    label: 'GPT-5.4 nano',
    provider: 'openai',
    description: 'Lowest-cost OpenAI option for simple extraction and ranking',
    inputCostPerMillion: 0.2,
    cachedInputCostPerMillion: 0.02,
    outputCostPerMillion: 1.25,
  },
  {
    id: 'gpt-5.6-terra',
    label: 'GPT-5.6 Terra',
    provider: 'openai',
    description: 'Balanced quality and cost',
    inputCostPerMillion: 2,
    cachedInputCostPerMillion: 0.2,
    outputCostPerMillion: 12,
  },
  {
    id: 'gpt-5.6-sol',
    label: 'GPT-5.6 Sol',
    provider: 'openai',
    description: 'Highest-quality OpenAI option',
    inputCostPerMillion: 5,
    cachedInputCostPerMillion: 0.5,
    outputCostPerMillion: 30,
  },
];

export const XAI_CURATED_MODELS: AiCuratedModel[] = [
  {
    id: 'grok-4.5',
    label: 'Grok 4.5',
    provider: 'xai',
    description: 'Highest-quality Grok model',
    recommended: true,
    inputCostPerMillion: 2,
    cachedInputCostPerMillion: 0.3,
    outputCostPerMillion: 6,
  },
  {
    id: 'grok-4.3',
    label: 'Grok 4.3',
    provider: 'xai',
    description: 'Faster mid-tier Grok model',
    inputCostPerMillion: 1.25,
    cachedInputCostPerMillion: 0.2,
    outputCostPerMillion: 2.5,
  },
];

export const ZERO_PRICING: AiModelPricing = {
  inputCostPerMillion: 0,
  cachedInputCostPerMillion: 0,
  outputCostPerMillion: 0,
};

export function curatedModelsForProvider(provider: AiProviderId): AiCuratedModel[] {
  if (provider === 'openai') return OPENAI_CURATED_MODELS;
  if (provider === 'xai') return XAI_CURATED_MODELS;
  return [];
}

export function findCuratedModel(provider: AiProviderId, modelId: string): AiCuratedModel | undefined {
  return curatedModelsForProvider(provider).find((model) => model.id === modelId);
}

export function providerLabel(provider: AiProviderId, customLabel?: string): string {
  if (provider === 'openai') return 'OpenAI';
  if (provider === 'xai') return 'xAI / Grok';
  if (provider === 'custom') return customLabel?.trim() || 'Custom compatible API';
  return 'Ollama';
}

export function estimateUsdCost(
  tokens: { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number },
  pricing: AiModelPricing,
): number | undefined {
  if (
    tokens.inputTokens == null
    && tokens.cachedInputTokens == null
    && tokens.outputTokens == null
  ) {
    return undefined;
  }
  const billableInput = Math.max(0, (tokens.inputTokens ?? 0) - (tokens.cachedInputTokens ?? 0));
  const cached = Math.max(0, tokens.cachedInputTokens ?? 0);
  const output = Math.max(0, tokens.outputTokens ?? 0);
  return (
    (billableInput * pricing.inputCostPerMillion)
    + (cached * pricing.cachedInputCostPerMillion)
    + (output * pricing.outputCostPerMillion)
  ) / 1_000_000;
}
