import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { getSettings } from './settings.service.js';
import { getProviderApiKey } from './ai-credentials.service.js';

const POST_TEXT_MIN_LENGTH = 12;
const DEFAULT_QUEUE_LIMIT = 1000;
let processorRunning = false;
let ollamaProcessStarted = false;
let processorStartedAt: Date | undefined;
let currentAssessmentId: string | undefined;
let currentPostUrl: string | undefined;
let processedInCurrentRun = 0;

interface AiActivityEntry {
  id: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  assessmentId?: string;
  postUrl?: string;
  createdAt: string;
}

const aiActivity: AiActivityEntry[] = [];

function logAiActivity(entry: Omit<AiActivityEntry, 'id' | 'createdAt'>) {
  const next = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
  };
  aiActivity.unshift(next);
  aiActivity.splice(100);
  const prefix = entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'info';
  console[prefix === 'error' ? 'error' : prefix === 'warn' ? 'warn' : 'log'](`[ai] ${entry.message}`);
}

interface AiRecommendation {
  memberId: string;
  scorePercent: string;
  reason?: string;
  suggestedIntro?: string;
}

interface ParsedAiAssessment {
  intent: string;
  isReferralOpportunity: boolean;
  confidence: number;
  summary: string;
  recommendedMembers: AiRecommendation[];
}

export function isRealFacebookPostPermalink(url?: string | null) {
  return Boolean(url && /^https:\/\/www\.facebook\.com\/groups\/[^/#?]+\/posts\/\d+/.test(url));
}

function promptVersion(promptTemplate: string, model: string) {
  return createHash('sha256').update(`${model}\n${promptTemplate}`).digest('hex').slice(0, 16);
}

type AiProvider = 'ollama' | 'openai' | 'xai' | 'custom';

interface ProviderConfig {
  provider: AiProvider;
  label: string;
  model: string;
  baseUrl?: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
}

interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  durationMs?: number;
  estimatedCostUsd?: number;
}

interface AiCallResult {
  text: string;
  usage: AiUsage;
}

function getProviderConfig(settings: Awaited<ReturnType<typeof getSettings>>): ProviderConfig {
  const provider = settings.ai.provider ?? 'ollama';
  if (provider === 'openai') {
    const model = settings.ai.openaiModel === '__custom__' ? settings.ai.openaiCustomModel : (settings.ai.openaiModel || 'gpt-5.6-luna');
    const pricing = model === 'gpt-5.6-luna'
      ? { input: 1, output: 6 }
      : model === 'gpt-5.4-nano'
        ? { input: 0.2, output: 1.25 }
        : model === 'gpt-5.6-terra'
          ? { input: 2.5, output: 15 }
          : model === 'gpt-5.6-sol' || model === 'gpt-5.6'
            ? { input: 5, output: 30 }
            : { input: 0, output: 0 };
    return { provider, label: 'OpenAI', model, baseUrl: 'https://api.openai.com/v1', inputCostPerMillion: pricing.input, outputCostPerMillion: pricing.output };
  }
  if (provider === 'xai') {
    const model = settings.ai.xaiModel === '__custom__' ? settings.ai.xaiCustomModel : (settings.ai.xaiModel || 'grok-4.5');
    const pricing = model === 'grok-4.5' ? { input: 2, output: 6 } : { input: 0, output: 0 };
    return { provider, label: 'xAI', model, baseUrl: 'https://api.x.ai/v1', inputCostPerMillion: pricing.input, outputCostPerMillion: pricing.output };
  }
  if (provider === 'custom') {
    return {
      provider,
      label: settings.ai.customProviderLabel || 'Custom compatible API',
      model: settings.ai.customModel,
      baseUrl: settings.ai.customBaseUrl.replace(/\/$/, ''),
      inputCostPerMillion: Math.max(0, settings.ai.customInputCostPerMillion || 0),
      outputCostPerMillion: Math.max(0, settings.ai.customOutputCostPerMillion || 0),
    };
  }
  return { provider: 'ollama', label: 'Ollama', model: settings.ai.ollamaModel, baseUrl: settings.ai.ollamaBaseUrl, inputCostPerMillion: 0, outputCostPerMillion: 0 };
}

function estimateCost(usage: AiUsage, provider: ProviderConfig) {
  if (!usage.inputTokens && !usage.outputTokens) return undefined;
  return ((usage.inputTokens ?? 0) * provider.inputCostPerMillion + (usage.outputTokens ?? 0) * provider.outputCostPerMillion) / 1_000_000;
}

function parsePercent(value: string | number | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
  const match = String(value ?? '').match(/(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  return Math.max(0, Math.min(1, Number(match[1]) / 100));
}

function normalisePercentString(value: string | number | undefined) {
  return `${Math.round(parsePercent(value) * 100)}%`;
}

function truncateForPrompt(value: string | null | undefined, maxChars: number) {
  const text = String(value ?? '').trim();
  if (text.length <= maxChars) return text || undefined;
  return `${text.slice(0, maxChars)}\n[truncated ${text.length - maxChars} character(s)]`;
}

function stripJsonFences(raw: string) {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function jsonCandidate(raw: string) {
  const trimmed = stripJsonFences(raw);
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function repairJsonCandidate(candidate: string) {
  return candidate
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/}\s*(?={\s*")/g, '},');
}

function parseJsonStringLiteral(value: string) {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
  } catch {
    return value;
  }
}

function readJsonStringField(source: string, key: string) {
  const match = source.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 's'));
  return match ? parseJsonStringLiteral(match[1]) : undefined;
}

function readJsonBooleanField(source: string, key: string) {
  const match = source.match(new RegExp(`"${key}"\\s*:\\s*(true|false)`, 'i'));
  return match ? match[1].toLowerCase() === 'true' : undefined;
}

function readJsonNumberField(source: string, key: string) {
  const match = source.match(new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`));
  return match ? Number(match[1]) : undefined;
}

function fallbackAssessmentFromMalformedJson(candidate: string): ParsedAiAssessment | undefined {
  const intent = readJsonStringField(candidate, 'intent');
  const summary = readJsonStringField(candidate, 'summary');
  if (!intent && !summary) return undefined;

  return {
    intent: intent ?? 'irrelevant',
    isReferralOpportunity: readJsonBooleanField(candidate, 'isReferralOpportunity') ?? false,
    confidence: readJsonNumberField(candidate, 'confidence') ?? 0,
    summary: summary ?? 'The model returned malformed JSON, but core fields were recovered.',
    recommendedMembers: [],
  };
}

function extractJson(raw: string) {
  const candidate = jsonCandidate(raw);
  try {
    return JSON.parse(candidate);
  } catch (firstError) {
    const repaired = repairJsonCandidate(candidate);
    try {
      return JSON.parse(repaired);
    } catch {
      const recovered = fallbackAssessmentFromMalformedJson(candidate);
      if (recovered) return recovered;
      throw firstError instanceof Error ? firstError : new Error('Model did not return parseable JSON.');
    }
  }
}

function validateParsedAssessment(value: unknown): ParsedAiAssessment {
  if (!value || typeof value !== 'object') throw new Error('Model JSON did not match the assessment schema.');
  const data = value as Partial<ParsedAiAssessment>;
  if (!('intent' in data) && !('summary' in data) && !('recommendedMembers' in data)) {
    throw new Error('Model JSON did not match the assessment schema.');
  }
  const allowedIntents = new Set(['looking_for_help', 'advertising', 'discussion', 'irrelevant']);
  const intent = allowedIntents.has(String(data.intent)) ? String(data.intent) : 'irrelevant';
  const recommendedMembers = Array.isArray(data.recommendedMembers) ? data.recommendedMembers : [];
  return {
    intent,
    isReferralOpportunity: Boolean(data.isReferralOpportunity),
    confidence: Math.max(0, Math.min(1, Number(data.confidence ?? 0))),
    summary: String(data.summary ?? '').slice(0, 2000),
    recommendedMembers: recommendedMembers
      .map((item) => item as Partial<AiRecommendation>)
      .filter((item) => item.memberId)
      .map((item) => ({
        memberId: String(item.memberId),
        scorePercent: normalisePercentString(item.scorePercent),
        reason: item.reason ? String(item.reason).slice(0, 2000) : undefined,
        suggestedIntro: item.suggestedIntro ? String(item.suggestedIntro).slice(0, 2000) : undefined,
      })),
  };
}

async function ollamaReachable(baseUrl: string) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureOllamaRunning() {
  const settings = await getSettings();
  if (await ollamaReachable(settings.ai.ollamaBaseUrl)) return { reachable: true, started: false };
  if (!settings.ai.autoStartOllama) return { reachable: false, started: false };
  if (!ollamaProcessStarted) {
    const child = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' });
    child.unref();
    ollamaProcessStarted = true;
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await ollamaReachable(settings.ai.ollamaBaseUrl)) return { reachable: true, started: true };
  }
  return { reachable: false, started: true };
}

function postPromptData(post: Awaited<ReturnType<typeof getPostForAssessment>>) {
  return {
    id: post.id,
    group: post.group?.friendlyName,
    authorName: post.authorName,
    canonicalPostUrl: post.canonicalPostUrl,
    text: truncateForPrompt(post.latestCapturedText, 3500),
    ocrText: truncateForPrompt(post.ocrText, 1200),
  };
}

function referralMemberPromptData(member: Awaited<ReturnType<typeof getActiveMembers>>[number]) {
  return {
    id: member.id,
    name: member.name,
    businessName: member.businessName,
    facebookName: member.facebookName,
    facebookProfileUrl: member.facebookProfileUrl,
    category: member.category,
    keywords: truncateForPrompt(member.keywords, 350),
    servicesOffered: truncateForPrompt(member.servicesOffered, 500),
    idealReferral: truncateForPrompt(member.idealReferral, 500),
    negativeKeywords: truncateForPrompt(member.negativeKeywords, 250),
  };
}

const stopWords = new Set(['about', 'after', 'again', 'also', 'and', 'are', 'been', 'but', 'can', 'for', 'from', 'have', 'help', 'here', 'into', 'just', 'looking', 'more', 'need', 'our', 'please', 'post', 'someone', 'that', 'the', 'their', 'this', 'with', 'would', 'your']);

function terms(value: string | null | undefined) {
  return new Set((value ?? '').toLowerCase().match(/[a-z][a-z0-9-]{2,}/g)?.filter((term) => !stopWords.has(term)) ?? []);
}

function selectCandidateMembers(post: Awaited<ReturnType<typeof getPostForAssessment>>, members: Awaited<ReturnType<typeof getActiveMembers>>, limit = 8) {
  const postTerms = terms(`${post.latestCapturedText ?? ''} ${post.ocrText ?? ''}`);
  return members
    .map((member) => {
      const positive = terms([member.category, member.keywords, member.servicesOffered, member.idealReferral].filter(Boolean).join(' '));
      const negative = terms(member.negativeKeywords);
      let score = 0;
      for (const term of postTerms) {
        if (positive.has(term)) score += 3;
        if (negative.has(term)) score -= 4;
      }
      return { member, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.member.name.localeCompare(right.member.name))
    .slice(0, limit)
    .map((entry) => entry.member);
}

function classificationPrompt(post: Awaited<ReturnType<typeof getPostForAssessment>>, promptTemplate: string) {
  const inputPayload = { post: postPromptData(post) };
  return {
    prompt: `${promptTemplate}\n\nFirst classify the post only. Do not assess members in this step. A post promoting the author's own business or services is advertising, not looking_for_help. Return only the assessment JSON with recommendedMembers as an empty array.`,
    userInput: `CLASSIFY_THIS_POST:\n${JSON.stringify(inputPayload.post, null, 2)}`,
    inputPayload,
  };
}

function matchingPrompt(post: Awaited<ReturnType<typeof getPostForAssessment>>, candidates: Awaited<ReturnType<typeof getActiveMembers>>, classification: ParsedAiAssessment, promptTemplate: string) {
  const inputPayload = {
    post: postPromptData(post),
    classification: { intent: classification.intent, summary: classification.summary, confidence: classification.confidence },
    referralMembers: candidates.map(referralMemberPromptData),
  };
  return {
    prompt: `${promptTemplate}\n\nThe post has already been classified as looking_for_help. Recommend only an exact memberId from the supplied short candidate list. Never invent a service need. If no candidate genuinely fits, return an empty recommendedMembers array and isReferralOpportunity false.`,
    userInput: `MATCH_THIS_HELP_REQUEST:\n${JSON.stringify(inputPayload, null, 2)}`,
    inputPayload,
  };
}

async function getPostForAssessment(postId: string) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { group: { select: { friendlyName: true } } },
  });
  if (!post) throw new Error('Post not found.');
  return post;
}

async function getActiveMembers() {
  return prisma.referralMember.findMany({
    where: { active: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });
}

export async function getAiStatus() {
  const settings = await getSettings();
  const provider = getProviderConfig(settings);
  const [pending, running, completed, failed, skipped, reachable, oldestRunning] = await Promise.all([
    prisma.postAiAssessment.count({ where: { status: 'pending' } }),
    prisma.postAiAssessment.count({ where: { status: 'running' } }),
    prisma.postAiAssessment.count({ where: { status: 'completed' } }),
    prisma.postAiAssessment.count({ where: { status: 'failed' } }),
    prisma.postAiAssessment.count({ where: { status: 'skipped' } }),
    ollamaReachable(settings.ai.ollamaBaseUrl),
    prisma.postAiAssessment.findFirst({
      where: { status: 'running' },
      orderBy: { startedAt: 'asc' },
      select: { startedAt: true },
    }),
  ]);
  return {
    enabled: settings.ai.enabled,
    autoAnalyse: settings.ai.autoAnalyse,
    provider: provider.provider,
    providerLabel: provider.label,
    model: provider.model,
    ollamaBaseUrl: settings.ai.ollamaBaseUrl,
    ollamaReachable: reachable,
    counts: { pending, running, completed, failed, skipped },
    processorRunning,
    processorStartedAt,
    currentAssessmentId,
    currentPostUrl,
    processedInCurrentRun,
    promptVersion: promptVersion(settings.ai.promptTemplate, `${provider.provider}:${provider.model}`),
    oldestRunningStartedAt: oldestRunning?.startedAt,
    staleRunningThresholdSeconds: settings.ai.staleRunningSeconds,
  };
}

export function getAiActivity() {
  return {
    processorRunning,
    processorStartedAt,
    currentAssessmentId,
    currentPostUrl,
    processedInCurrentRun,
    items: aiActivity,
  };
}

function eligiblePost(post: {
  canonicalPostUrl: string;
  latestCapturedText?: string | null;
  extractionConfidence?: number | null;
}, settings: Awaited<ReturnType<typeof getSettings>>) {
  if (!settings.ai.enabled) return { eligible: false, reason: 'ai_disabled' };
  if (settings.ai.requireRealFacebookPermalink && !isRealFacebookPostPermalink(post.canonicalPostUrl)) {
    return { eligible: false, reason: 'missing_real_permalink' };
  }
  if ((post.latestCapturedText ?? '').trim().length < POST_TEXT_MIN_LENGTH) return { eligible: false, reason: 'missing_post_context' };
  if ((post.extractionConfidence ?? 0) < settings.ai.minExtractionConfidence) return { eligible: false, reason: 'low_extraction_confidence' };
  return { eligible: true, reason: 'eligible' };
}

export async function queuePostForAi(postId: string, options: { force?: boolean; process?: boolean } = {}) {
  const settings = await getSettings();
  const post = await getPostForAssessment(postId);
  const provider = getProviderConfig(settings);
  const version = promptVersion(settings.ai.promptTemplate, `${provider.provider}:${provider.model}`);
  const eligibility = eligiblePost(post, settings);
  if (!eligibility.eligible && !options.force) return { queued: false, reason: eligibility.reason };

  if (!options.force) {
    const existing = await prisma.postAiAssessment.findFirst({
      where: { postId, promptVersion: version, status: { in: ['pending', 'running', 'completed'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return { queued: false, reason: `already_${existing.status}`, assessment: existing };
  }

  const assessment = await prisma.postAiAssessment.create({
    data: {
      postId,
      status: eligibility.eligible ? 'pending' : 'skipped',
      provider: provider.provider,
      model: provider.model,
      promptVersion: version,
      promptText: settings.ai.promptTemplate,
      errorMessage: eligibility.eligible ? null : eligibility.reason,
    },
  });
  if (options.process && assessment.status === 'pending') startAiQueueProcessor();
  return { queued: assessment.status === 'pending', reason: assessment.status, assessment };
}

export async function queuePostAfterScrape(postId: string) {
  const settings = await getSettings();
  if (!settings.ai.enabled || !settings.ai.autoAnalyse) return { queued: false, reason: 'auto_analysis_disabled' };
  return queuePostForAi(postId, { process: true });
}

export async function queueEligiblePosts(limit = 200, options: { force?: boolean } = {}) {
  const settings = await getSettings();
  const posts = await prisma.post.findMany({
    where: {
      monitoringStatus: 'active',
      latestCapturedText: { not: null },
      extractionConfidence: { gte: settings.ai.minExtractionConfidence },
    },
    orderBy: { firstDiscoveredAt: 'desc' },
    take: Math.max(1, Math.min(1000, limit)),
    select: { id: true, canonicalPostUrl: true, latestCapturedText: true, extractionConfidence: true },
  });

  let queued = 0;
  let skipped = 0;
  for (const post of posts) {
    const result = await queuePostForAi(post.id, { force: options.force });
    if (result.queued) queued += 1;
    else skipped += 1;
  }
  return { inspected: posts.length, queued, skipped };
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

async function callOllama(systemPrompt: string, userInput: string, provider: ProviderConfig): Promise<AiCallResult> {
  const settings = await getSettings();
  const baseUrl = provider.baseUrl?.replace(/\/$/, '') ?? settings.ai.ollamaBaseUrl.replace(/\/$/, '');
  const timeoutMs = Math.max(30, settings.ai.ollamaRequestTimeoutSeconds) * 1000;
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
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
        num_predict: 700,
        num_ctx: 16384,
      },
    }),
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Ollama returned HTTP ${response.status}${errorBody ? `: ${errorBody.slice(0, 500)}` : ''}.`);
  }
  const body = await response.json() as { message?: { content?: string }; response?: string; prompt_eval_count?: number; eval_count?: number };
  const inputTokens = body.prompt_eval_count;
  const outputTokens = body.eval_count;
  return {
    text: body.message?.content ?? body.response ?? JSON.stringify(body),
    usage: { inputTokens, outputTokens, totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0), durationMs: Date.now() - startedAt },
  };
}

async function callRemoteCompatible(systemPrompt: string, userInput: string, provider: ProviderConfig): Promise<AiCallResult> {
  if (!provider.baseUrl || !provider.model) throw new Error('Choose a remote API base URL and model before processing the queue.');
  const apiKey = await getProviderApiKey(provider.provider);
  if (!apiKey) throw new Error(`No ${provider.label} API key is saved. Add it in Settings before processing the queue.`);
  const settings = await getSettings();
  const startedAt = Date.now();
  const response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(Math.max(30, settings.ai.ollamaRequestTimeoutSeconds) * 1000),
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userInput },
      ],
      response_format: provider.provider === 'custom'
        ? { type: 'json_object' }
        : { type: 'json_schema', json_schema: assessmentJsonSchema },
      max_completion_tokens: 900,
    }),
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`${provider.label} returned HTTP ${response.status}${errorBody ? `: ${errorBody.slice(0, 500)}` : ''}.`);
  }
  const body = await response.json() as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const content = body.choices?.[0]?.message?.content;
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part) => part.text ?? '').join('')
      : JSON.stringify(body);
  const usage = {
    inputTokens: body.usage?.prompt_tokens,
    outputTokens: body.usage?.completion_tokens,
    totalTokens: body.usage?.total_tokens ?? ((body.usage?.prompt_tokens ?? 0) + (body.usage?.completion_tokens ?? 0)),
    durationMs: Date.now() - startedAt,
  };
  return { text, usage: { ...usage, estimatedCostUsd: estimateCost(usage, provider) } };
}

async function callAiProvider(systemPrompt: string, userInput: string, provider: ProviderConfig) {
  return provider.provider === 'ollama'
    ? callOllama(systemPrompt, userInput, provider)
    : callRemoteCompatible(systemPrompt, userInput, provider);
}

export async function runAssessment(assessmentId: string) {
  const settings = await getSettings();
  const provider = getProviderConfig(settings);
  const assessment = await prisma.postAiAssessment.update({
    where: { id: assessmentId },
    data: { status: 'running', startedAt: new Date(), errorMessage: null },
  });
  let rawText: unknown;
  let prompt: string | undefined;
  let userInput: string | undefined;
  let inputPayload: unknown;
  let usage: AiUsage = {};
  try {
    const version = promptVersion(settings.ai.promptTemplate, `${provider.provider}:${provider.model}`);
    const post = await getPostForAssessment(assessment.postId);
    currentAssessmentId = assessmentId;
    currentPostUrl = post.canonicalPostUrl;
    logAiActivity({ level: 'info', message: `Started assessment for ${post.canonicalPostUrl}`, assessmentId, postUrl: post.canonicalPostUrl });
    const members = await getActiveMembers();
    const classificationData = classificationPrompt(post, settings.ai.promptTemplate);
    prompt = classificationData.prompt;
    userInput = classificationData.userInput;
    inputPayload = { classification: classificationData.inputPayload };
    const classificationResult = await callAiProvider(classificationData.prompt, classificationData.userInput, provider);
    const classification = validateParsedAssessment(extractJson(classificationResult.text));
    usage = classificationResult.usage;
    let parsed: ParsedAiAssessment = { ...classification, recommendedMembers: [] };
    rawText = { classification: classificationResult.text };
    let candidateMembers: Awaited<ReturnType<typeof getActiveMembers>> = [];
    if (classification.intent === 'looking_for_help') {
      candidateMembers = selectCandidateMembers(post, members);
      if (candidateMembers.length > 0) {
        const matchingData = matchingPrompt(post, candidateMembers, classification, settings.ai.promptTemplate);
        const matchResult = await callAiProvider(matchingData.prompt, matchingData.userInput, provider);
        const matching = validateParsedAssessment(extractJson(matchResult.text));
        parsed = { ...matching, intent: 'looking_for_help' };
        prompt = `${classificationData.prompt}\n\n--- MATCHING PROMPT ---\n${matchingData.prompt}`;
        userInput = `${classificationData.userInput}\n\n--- MATCHING INPUT ---\n${matchingData.userInput}`;
        inputPayload = { classification: classificationData.inputPayload, matching: matchingData.inputPayload };
        rawText = { classification: classificationResult.text, matching: matchResult.text };
        usage = {
          inputTokens: (classificationResult.usage.inputTokens ?? 0) + (matchResult.usage.inputTokens ?? 0),
          outputTokens: (classificationResult.usage.outputTokens ?? 0) + (matchResult.usage.outputTokens ?? 0),
          totalTokens: (classificationResult.usage.totalTokens ?? 0) + (matchResult.usage.totalTokens ?? 0),
          durationMs: (classificationResult.usage.durationMs ?? 0) + (matchResult.usage.durationMs ?? 0),
        };
        usage.estimatedCostUsd = estimateCost(usage, provider);
      } else {
        parsed = { ...classification, isReferralOpportunity: false, recommendedMembers: [], summary: `${classification.summary} No suitable referral candidates were found locally.`.trim() };
      }
    }
    const candidateMemberIds = new Set(candidateMembers.map((member) => member.id));
    const validMatches = classification.intent === 'looking_for_help'
      ? parsed.recommendedMembers.filter((match) => candidateMemberIds.has(match.memberId))
      : [];

    await prisma.$transaction([
      prisma.aiMemberMatch.deleteMany({ where: { assessmentId } }),
      prisma.postAiAssessment.update({
        where: { id: assessmentId },
        data: {
          status: 'completed',
          provider: provider.provider,
          model: provider.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          estimatedCostUsd: usage.estimatedCostUsd,
          durationMs: usage.durationMs,
          promptVersion: version,
          promptText: settings.ai.promptTemplate,
          renderedPrompt: prompt,
          inputPayload: inputPayload as unknown as object,
          rawResponse: rawText as object,
          parsed: parsed as unknown as object,
          intent: parsed.intent,
          isReferralOpportunity: parsed.isReferralOpportunity,
          confidence: parsed.confidence,
          summary: parsed.summary,
          completedAt: new Date(),
          errorMessage: null,
        },
      }),
      ...validMatches
        .map((match) => ({
          referralMemberId: match.memberId,
          score: parsePercent(match.scorePercent),
          scorePercent: normalisePercentString(match.scorePercent),
          reason: match.reason ?? null,
          suggestedIntro: match.suggestedIntro ?? null,
        }))
        .filter((match) => match.score >= Math.max(0, Math.min(100, settings.ai.minMatchPercent)) / 100)
        .map((match) => prisma.aiMemberMatch.create({ data: { assessmentId, ...match } })),
    ]);
    logAiActivity({
      level: 'info',
      message: `Completed assessment as ${parsed.intent}${parsed.isReferralOpportunity ? ' with referral match' : ''}.`,
      assessmentId,
      postUrl: post.canonicalPostUrl,
    });
    return { status: 'completed', parsed };
  } catch (error) {
    const post = await prisma.post.findUnique({ where: { id: assessment.postId }, select: { canonicalPostUrl: true } });
    const message = error instanceof Error && error.name === 'TimeoutError'
      ? `Ollama timed out after ${settings.ai.ollamaRequestTimeoutSeconds}s.`
      : error instanceof Error ? error.message : String(error);
    const failureData: Prisma.PostAiAssessmentUpdateInput = {
      status: 'failed',
      errorMessage: message,
      completedAt: new Date(),
    };
    if (rawText) failureData.rawResponse = rawText as object;
    if (prompt) failureData.renderedPrompt = prompt;
    if (inputPayload) failureData.inputPayload = inputPayload as unknown as object;
    await prisma.postAiAssessment.update({
      where: { id: assessmentId },
      data: failureData,
    });
    logAiActivity({ level: 'error', message: `Assessment failed: ${message}`, assessmentId, postUrl: post?.canonicalPostUrl });
    return { status: 'failed', error: message };
  } finally {
    currentAssessmentId = undefined;
    currentPostUrl = undefined;
  }
}

export function startAiQueueProcessor(limit = DEFAULT_QUEUE_LIMIT) {
  if (processorRunning) return { started: false, reason: 'processor_already_running' };
  void processAiQueue(limit).catch((error) => {
    console.error('AI queue processor failed:', error);
    logAiActivity({ level: 'error', message: `AI queue processor failed: ${error instanceof Error ? error.message : String(error)}` });
  });
  return { started: true, mode: 'background' };
}

export async function resumeAiQueueIfNeeded() {
  const settings = await getSettings();
  if (!settings.ai.enabled || !settings.ai.autoAnalyse || processorRunning) {
    return { started: false, reason: 'auto_analysis_disabled_or_running' };
  }
  const stale = await resetOrphanedRunningAssessments('Re-queued after API worker restart.');
  const pending = await prisma.postAiAssessment.count({ where: { status: 'pending' } });
  if (pending <= 0) return { started: false, pending, stale };
  logAiActivity({ level: 'info', message: `Auto-resuming AI queue with ${pending} pending assessment(s).` });
  return { ...startAiQueueProcessor(), pending, stale };
}

export async function processAiQueue(limit = DEFAULT_QUEUE_LIMIT) {
  if (processorRunning) return { started: false, reason: 'processor_already_running' };
  processorRunning = true;
  processorStartedAt = new Date();
  processedInCurrentRun = 0;
  const maxItems = Math.max(1, Math.min(10000, limit));
  let processed = 0;
  const results = [];
  try {
    logAiActivity({ level: 'info', message: `AI processor started with limit ${maxItems}.` });
    await resetOrphanedRunningAssessments('Re-queued before starting a new AI processor.');
    const settings = await getSettings();
    const provider = getProviderConfig(settings);
    if (provider.provider === 'ollama') {
      const ollama = await ensureOllamaRunning();
      if (!ollama.reachable) throw new Error('Ollama is not reachable. Install/start Ollama and pull the configured model.');
    } else {
      if (!provider.baseUrl || !provider.model) throw new Error(`Configure a base URL and model for ${provider.label}.`);
      if (!await getProviderApiKey(provider.provider)) throw new Error(`No ${provider.label} API key is saved. Add it in Settings before processing the queue.`);
    }
    while (processed < maxItems) {
      const assessment = await prisma.postAiAssessment.findFirst({
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
      });
      if (!assessment) break;
      results.push(await runAssessment(assessment.id));
      processed += 1;
      processedInCurrentRun = processed;
    }
    logAiActivity({ level: 'info', message: `AI processor stopped after processing ${processed} item(s).` });
    return { started: true, processed, drained: processed < maxItems, results };
  } finally {
    processorRunning = false;
    processorStartedAt = undefined;
    currentAssessmentId = undefined;
    currentPostUrl = undefined;
  }
}

export async function resetOrphanedRunningAssessments(reason = 'Re-queued after AI processor restart.') {
  const result = await prisma.postAiAssessment.updateMany({
    where: { status: 'running' },
    data: {
      status: 'pending',
      startedAt: null,
      errorMessage: reason,
    },
  });
  if (result.count > 0) {
    logAiActivity({ level: 'warn', message: `Re-queued ${result.count} orphaned running assessment(s).` });
  }
  return { reset: result.count };
}

export async function resetStaleRunningAssessments(maxAgeSeconds?: number) {
  const settings = await getSettings();
  const staleSeconds = maxAgeSeconds ?? settings.ai.staleRunningSeconds;
  const threshold = new Date(Date.now() - Math.max(30, staleSeconds) * 1000);
  const result = await prisma.postAiAssessment.updateMany({
    where: {
      status: 'running',
      startedAt: { lt: threshold },
    },
    data: {
      status: 'pending',
      startedAt: null,
      errorMessage: 'Re-queued after stale running timeout.',
    },
  });
  if (result.count > 0) {
    logAiActivity({ level: 'warn', message: `Re-queued ${result.count} stale running assessment(s).` });
  }
  return { reset: result.count, threshold: threshold.toISOString() };
}

interface AiAssessmentFilters {
  status?: string;
  intent?: string;
  referral?: string;
  match?: string;
  memberId?: string;
  minConfidence?: number;
  search?: string;
  page?: number;
  pageSize?: number;
}

export async function listAiAssessments(filters: AiAssessmentFilters = {}) {
  const {
    status = 'all',
    intent = 'all',
    referral = 'all',
    match = 'all',
    memberId,
    minConfidence,
    search,
    page = 1,
    pageSize = 25,
  } = filters;
  const where: Prisma.PostAiAssessmentWhereInput = {};
  if (status !== 'all') where.status = status;
  if (intent !== 'all') where.intent = intent;
  if (referral === 'opportunity') where.isReferralOpportunity = true;
  if (referral === 'not_referral') where.isReferralOpportunity = false;
  if (typeof minConfidence === 'number' && Number.isFinite(minConfidence)) where.confidence = { gte: Math.max(0, Math.min(1, minConfidence)) };
  if (memberId) where.memberMatches = { some: { referralMemberId: memberId } };
  if (match === 'with_matches' && !memberId) where.memberMatches = { some: {} };
  if (match === 'without_matches') where.memberMatches = { none: {} };
  if (search?.trim()) {
    const query = search.trim();
    where.OR = [
      { summary: { contains: query } },
      { errorMessage: { contains: query } },
      { post: { latestCapturedText: { contains: query } } },
      { post: { authorName: { contains: query } } },
      { post: { canonicalPostUrl: { contains: query } } },
      { post: { group: { friendlyName: { contains: query } } } },
      { memberMatches: { some: { reason: { contains: query } } } },
      { memberMatches: { some: { suggestedIntro: { contains: query } } } },
      { memberMatches: { some: { referralMember: { name: { contains: query } } } } },
      { memberMatches: { some: { referralMember: { category: { contains: query } } } } },
      { memberMatches: { some: { referralMember: { businessName: { contains: query } } } } },
    ];
  }
  const skip = Math.max(0, page - 1) * pageSize;
  const take = Math.max(1, Math.min(100, pageSize));
  const [items, total] = await Promise.all([
    prisma.postAiAssessment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        post: {
          select: {
            id: true,
            canonicalPostUrl: true,
            latestCapturedText: true,
            authorName: true,
            originalTimestampLabel: true,
            originalPostedAt: true,
            extractionConfidence: true,
            group: { select: { friendlyName: true } },
          },
        },
        memberMatches: { include: { referralMember: true }, orderBy: { score: 'desc' } },
      },
    }),
    prisma.postAiAssessment.count({ where }),
  ]);
  return { items, total };
}
