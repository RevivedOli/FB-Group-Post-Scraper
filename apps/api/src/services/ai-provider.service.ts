import { spawn } from 'node:child_process';
import type {
  AiModelPricing,
  AiPricingSnapshot,
  AiProviderHealth,
  AiProviderId,
  AppSettings,
} from '@local-group-monitor/shared';
import {
  AI_PRICING_CATALOG_VERSION,
  CUSTOM_MODEL_SENTINEL,
  ZERO_PRICING,
  estimateUsdCost,
  findCuratedModel,
  providerLabel,
} from '@local-group-monitor/shared';
import { getProviderApiKey } from './ai-credentials.service.js';
import { getSettings } from './settings.service.js';

export interface ProviderRuntimeConfig {
  provider: AiProviderId;
  label: string;
  model: string;
  baseUrl?: string;
  pricing: AiModelPricing;
  pricingSnapshot: AiPricingSnapshot;
}

export interface AiUsageMetrics {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  durationMs?: number;
  estimatedCostUsd?: number;
  requestCount?: number;
}

export interface AiCallResult {
  text: string;
  usage: AiUsageMetrics;
}

const assessmentJsonSchema = {
  name: 'referral_assessment',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['intent', 'isReferralOpportunity', 'confidence', 'summary', 'recommendedMembers'],
    properties: {
      intent: { type: 'string', enum: ['looking_for_help', 'advertising', 'discussion', 'irrelevant'] },
      isReferralOpportunity: { type: 'boolean' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      summary: { type: 'string' },
      recommendedMembers: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['memberId', 'scorePercent', 'reason', 'suggestedIntro'],
          properties: {
            memberId: { type: 'string' },
            scorePercent: { type: 'string' },
            reason: { type: 'string' },
            suggestedIntro: { type: 'string' },
          },
        },
      },
    },
  },
};

let ollamaProcessStarted = false;

function truncateErrorBody(body: string, max = 400) {
  const cleaned = body.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max)}…`;
}

function resolveModelAndPricing(settings: AppSettings): { model: string; pricing: AiModelPricing; baseUrl?: string } {
  const ai = settings.ai;
  if (ai.provider === 'openai') {
    if (ai.openaiModel === CUSTOM_MODEL_SENTINEL) {
      return {
        model: ai.openaiCustomModel,
        baseUrl: 'https://api.openai.com/v1',
        pricing: {
          inputCostPerMillion: ai.openaiCustomInputCostPerMillion,
          cachedInputCostPerMillion: ai.openaiCustomCachedInputCostPerMillion,
          outputCostPerMillion: ai.openaiCustomOutputCostPerMillion,
        },
      };
    }
    const curated = findCuratedModel('openai', ai.openaiModel);
    return {
      model: ai.openaiModel || 'gpt-5.6-luna',
      baseUrl: 'https://api.openai.com/v1',
      pricing: curated ?? ZERO_PRICING,
    };
  }
  if (ai.provider === 'xai') {
    if (ai.xaiModel === CUSTOM_MODEL_SENTINEL) {
      return {
        model: ai.xaiCustomModel,
        baseUrl: 'https://api.x.ai/v1',
        pricing: {
          inputCostPerMillion: ai.xaiCustomInputCostPerMillion,
          cachedInputCostPerMillion: ai.xaiCustomCachedInputCostPerMillion,
          outputCostPerMillion: ai.xaiCustomOutputCostPerMillion,
        },
      };
    }
    const curated = findCuratedModel('xai', ai.xaiModel);
    return {
      model: ai.xaiModel || 'grok-4.5',
      baseUrl: 'https://api.x.ai/v1',
      pricing: curated ?? ZERO_PRICING,
    };
  }
  if (ai.provider === 'custom') {
    return {
      model: ai.customModel,
      baseUrl: ai.customBaseUrl.replace(/\/$/, ''),
      pricing: {
        inputCostPerMillion: ai.customInputCostPerMillion,
        cachedInputCostPerMillion: ai.customCachedInputCostPerMillion,
        outputCostPerMillion: ai.customOutputCostPerMillion,
      },
    };
  }
  return {
    model: ai.ollamaModel,
    baseUrl: ai.ollamaBaseUrl.replace(/\/$/, ''),
    pricing: ZERO_PRICING,
  };
}

export function getProviderConfig(settings: AppSettings): ProviderRuntimeConfig {
  const resolved = resolveModelAndPricing(settings);
  const label = providerLabel(settings.ai.provider, settings.ai.customProviderLabel);
  const pricingSnapshot: AiPricingSnapshot = {
    catalogVersion: AI_PRICING_CATALOG_VERSION,
    provider: settings.ai.provider,
    providerLabel: label,
    model: resolved.model,
    baseUrl: resolved.baseUrl,
    estimated: true,
    ...resolved.pricing,
  };
  return {
    provider: settings.ai.provider,
    label,
    model: resolved.model,
    baseUrl: resolved.baseUrl,
    pricing: resolved.pricing,
    pricingSnapshot,
  };
}

export async function ollamaReachable(baseUrl: string) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function listOllamaModels(baseUrl: string) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
  const body = await response.json() as { models?: Array<{ name?: string }> };
  return (body.models ?? []).map((model) => model.name).filter((name): name is string => Boolean(name));
}

export async function ensureOllamaRunning(settings?: AppSettings) {
  const current = settings ?? await getSettings();
  if (await ollamaReachable(current.ai.ollamaBaseUrl)) return { reachable: true, started: false };
  if (!current.ai.autoStartOllama) return { reachable: false, started: false };
  if (!ollamaProcessStarted) {
    const child = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' });
    child.unref();
    ollamaProcessStarted = true;
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await ollamaReachable(current.ai.ollamaBaseUrl)) return { reachable: true, started: true };
  }
  return { reachable: false, started: true };
}

export async function getProviderHealth(settings?: AppSettings): Promise<AiProviderHealth> {
  const current = settings ?? await getSettings();
  const provider = getProviderConfig(current);
  if (provider.provider === 'ollama') {
    const reachable = await ollamaReachable(provider.baseUrl ?? current.ai.ollamaBaseUrl);
    return {
      provider: provider.provider,
      providerLabel: provider.label,
      model: provider.model,
      baseUrl: provider.baseUrl,
      reachable,
      detail: reachable ? 'Ollama is reachable.' : 'Ollama is offline. Start Ollama or enable auto-start.',
    };
  }
  const hasApiKey = Boolean(await getProviderApiKey(provider.provider));
  const configured = Boolean(provider.baseUrl && provider.model);
  return {
    provider: provider.provider,
    providerLabel: provider.label,
    model: provider.model,
    baseUrl: provider.baseUrl,
    reachable: configured && hasApiKey,
    hasApiKey,
    detail: !configured
      ? `Configure a base URL and model for ${provider.label}.`
      : !hasApiKey
        ? `No ${provider.label} API key is saved in Keychain.`
        : `${provider.label} is configured.`,
  };
}

export async function testProviderConnection(settings?: AppSettings) {
  const current = settings ?? await getSettings();
  const provider = getProviderConfig(current);
  if (provider.provider === 'ollama') {
    const reachable = await ollamaReachable(provider.baseUrl ?? current.ai.ollamaBaseUrl);
    if (!reachable) throw new Error('Ollama is not reachable.');
    const models = await listOllamaModels(provider.baseUrl ?? current.ai.ollamaBaseUrl);
    return { ok: true, provider: provider.provider, model: provider.model, models };
  }
  if (!provider.baseUrl || !provider.model) throw new Error(`Configure a base URL and model for ${provider.label}.`);
  const apiKey = await getProviderApiKey(provider.provider);
  if (!apiKey) throw new Error(`No ${provider.label} API key is saved. Add it in Settings first.`);

  if (provider.provider === 'openai') {
    const response = await fetch(`${provider.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`OpenAI connection failed (HTTP ${response.status})${errorBody ? `: ${truncateErrorBody(errorBody)}` : ''}.`);
    }
    return { ok: true, provider: provider.provider, model: provider.model };
  }

  const response = await fetch(`${provider.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    // Some OpenAI-compatible hosts do not expose /models; fall back to a tiny chat completion probe.
    const probe = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(Math.max(30, current.ai.requestTimeoutSeconds) * 1000),
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: 'user', content: 'Reply with the single word ok.' }],
        max_tokens: 5,
      }),
    });
    if (!probe.ok) {
      const errorBody = await probe.text().catch(() => '');
      throw new Error(`${provider.label} connection failed (HTTP ${probe.status})${errorBody ? `: ${truncateErrorBody(errorBody)}` : ''}.`);
    }
    return { ok: true, provider: provider.provider, model: provider.model, probed: 'chat' };
  }
  return { ok: true, provider: provider.provider, model: provider.model };
}

function withCost(usage: AiUsageMetrics, pricing: AiModelPricing): AiUsageMetrics {
  return {
    ...usage,
    estimatedCostUsd: estimateUsdCost(usage, pricing),
    requestCount: usage.requestCount ?? 1,
  };
}

async function callOllama(systemPrompt: string, userInput: string, provider: ProviderRuntimeConfig, timeoutSeconds: number): Promise<AiCallResult> {
  const baseUrl = provider.baseUrl?.replace(/\/$/, '') ?? 'http://127.0.0.1:11434';
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(Math.max(30, timeoutSeconds) * 1000),
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userInput },
      ],
      stream: false,
      format: 'json',
      keep_alive: '10m',
      options: {
        temperature: 0,
        num_predict: 900,
        num_ctx: 16384,
      },
    }),
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Ollama returned HTTP ${response.status}${errorBody ? `: ${truncateErrorBody(errorBody)}` : ''}.`);
  }
  const body = await response.json() as {
    message?: { content?: string };
    response?: string;
    prompt_eval_count?: number;
    eval_count?: number;
  };
  const inputTokens = body.prompt_eval_count;
  const outputTokens = body.eval_count;
  return {
    text: body.message?.content ?? body.response ?? JSON.stringify(body),
    usage: withCost({
      inputTokens,
      outputTokens,
      totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
      durationMs: Date.now() - startedAt,
      requestCount: 1,
    }, provider.pricing),
  };
}

async function callOpenAiResponses(systemPrompt: string, userInput: string, provider: ProviderRuntimeConfig, apiKey: string, timeoutSeconds: number): Promise<AiCallResult> {
  const startedAt = Date.now();
  const response = await fetch(`${provider.baseUrl}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(Math.max(30, timeoutSeconds) * 1000),
    body: JSON.stringify({
      model: provider.model,
      max_output_tokens: 900,
      text: {
        format: {
          type: 'json_schema',
          name: assessmentJsonSchema.name,
          strict: true,
          schema: assessmentJsonSchema.schema,
        },
      },
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userInput },
      ],
    }),
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    // Fall back to chat completions when Responses is unavailable for the account/model.
    if (response.status === 404 || /not supported|unsupported|unknown parameter|does not support/i.test(errorBody)) {
      return callRemoteChatCompletions(systemPrompt, userInput, provider, apiKey, timeoutSeconds, true);
    }
    throw new Error(`OpenAI returned HTTP ${response.status}${errorBody ? `: ${truncateErrorBody(errorBody)}` : ''}.`);
  }
  const body = await response.json() as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
    };
  };
  const textFromOutput = body.output
    ?.flatMap((item) => item.content ?? [])
    .map((part) => part.text ?? '')
    .join('') ?? '';
  const text = body.output_text || textFromOutput || JSON.stringify(body);
  const usage = {
    inputTokens: body.usage?.input_tokens,
    cachedInputTokens: body.usage?.input_tokens_details?.cached_tokens,
    outputTokens: body.usage?.output_tokens,
    totalTokens: body.usage?.total_tokens
      ?? ((body.usage?.input_tokens ?? 0) + (body.usage?.output_tokens ?? 0)),
    durationMs: Date.now() - startedAt,
    requestCount: 1,
  };
  return { text, usage: withCost(usage, provider.pricing) };
}

async function callRemoteChatCompletions(
  systemPrompt: string,
  userInput: string,
  provider: ProviderRuntimeConfig,
  apiKey: string,
  timeoutSeconds: number,
  useJsonSchema: boolean,
): Promise<AiCallResult> {
  const startedAt = Date.now();
  // OpenAI GPT-5.x models reject temperature:0 and only accept the default.
  // Omit temperature for OpenAI; keep deterministic sampling for compatible hosts.
  const payload: Record<string, unknown> = {
    model: provider.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userInput },
    ],
    max_completion_tokens: 900,
    response_format: useJsonSchema
      ? { type: 'json_schema', json_schema: assessmentJsonSchema }
      : { type: 'json_object' },
  };
  if (provider.provider !== 'openai') payload.temperature = 0;
  const response = await fetch(`${provider.baseUrl?.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(Math.max(30, timeoutSeconds) * 1000),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`${provider.label} returned HTTP ${response.status}${errorBody ? `: ${truncateErrorBody(errorBody)}` : ''}.`);
  }
  const body = await response.json() as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };
  const content = body.choices?.[0]?.message?.content;
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part) => part.text ?? '').join('')
      : JSON.stringify(body);
  const usage = {
    inputTokens: body.usage?.prompt_tokens,
    cachedInputTokens: body.usage?.prompt_tokens_details?.cached_tokens,
    outputTokens: body.usage?.completion_tokens,
    totalTokens: body.usage?.total_tokens
      ?? ((body.usage?.prompt_tokens ?? 0) + (body.usage?.completion_tokens ?? 0)),
    durationMs: Date.now() - startedAt,
    requestCount: 1,
  };
  return { text, usage: withCost(usage, provider.pricing) };
}

export async function callAiProvider(systemPrompt: string, userInput: string, provider: ProviderRuntimeConfig, timeoutSeconds: number): Promise<AiCallResult> {
  if (provider.provider === 'ollama') {
    return callOllama(systemPrompt, userInput, provider, timeoutSeconds);
  }
  if (!provider.baseUrl || !provider.model) {
    throw new Error(`Choose a ${provider.label} base URL and model before processing the queue.`);
  }
  const apiKey = await getProviderApiKey(provider.provider);
  if (!apiKey) {
    throw new Error(`No ${provider.label} API key is saved. Add it in Settings before processing the queue.`);
  }
  if (provider.provider === 'openai') {
    return callOpenAiResponses(systemPrompt, userInput, provider, apiKey, timeoutSeconds);
  }
  return callRemoteChatCompletions(systemPrompt, userInput, provider, apiKey, timeoutSeconds, provider.provider !== 'custom');
}

export { assessmentJsonSchema, truncateErrorBody };
