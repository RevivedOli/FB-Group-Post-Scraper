import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { AiPricingSnapshot, AiUsageByDay, AiUsageByProviderModel, AiUsageReport, AiUsageTotals } from '@local-group-monitor/shared';
import { matchesAiPrefilter, parseAiPrefilterPhrases, providerLabel } from '@local-group-monitor/shared';
import { prisma } from '../db/prisma.js';
import { getSettings } from './settings.service.js';
import {
  callAiProvider,
  ensureOllamaRunning,
  getProviderConfig,
  getProviderHealth,
  ollamaReachable,
  type AiUsageMetrics,
  type ProviderRuntimeConfig,
} from './ai-provider.service.js';
import { getProviderApiKey } from './ai-credentials.service.js';

const POST_TEXT_MIN_LENGTH = 12;
const DEFAULT_QUEUE_LIMIT = 1000;
const MAX_REMOTE_CONCURRENCY = 20;
let processorRunning = false;
let processorStartedAt: Date | undefined;
let processedInCurrentRun = 0;
const activeJobs = new Map<string, string | undefined>();

function currentAssessmentId() {
  return [...activeJobs.keys()][0];
}

function currentPostUrl() {
  return [...activeJobs.values()].find(Boolean);
}

function effectiveConcurrencyFor(provider: string, remoteConcurrency: number) {
  if (provider === 'ollama') return 1;
  return Math.max(1, Math.min(MAX_REMOTE_CONCURRENCY, Math.round(remoteConcurrency || 1)));
}

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

function promptVersion(promptTemplate: string, providerKey: string, prefilterKey = '') {
  return createHash('sha256').update(`${providerKey}\n${promptTemplate}\n${prefilterKey}`).digest('hex').slice(0, 16);
}

function prefilterVersionKey(settings: Awaited<ReturnType<typeof getSettings>>) {
  if (!settings.ai.prefilterEnabled) return 'prefilter:off';
  const phrases = parseAiPrefilterPhrases(settings.ai.prefilterPhrases).sort().join('|');
  return `prefilter:on:${phrases}`;
}

export function describeSkipReason(reason: string) {
  switch (reason) {
    case 'prefilter_no_match':
      return 'Skipped: no pre-filter trigger phrase matched. Post was not sent to the LLM.';
    case 'ai_disabled':
      return 'Skipped: AI analysis is disabled.';
    case 'missing_real_permalink':
      return 'Skipped: post does not have a real Facebook permalink.';
    case 'missing_post_context':
      return 'Skipped: post text is too short for analysis.';
    case 'low_extraction_confidence':
      return 'Skipped: extraction confidence is below the configured minimum.';
    default:
      return `Skipped: ${reason.replace(/_/g, ' ')}.`;
  }
}

function analysisStatusForAssessment(status: string) {
  switch (status) {
    case 'pending':
      return 'queued';
    case 'running':
      return 'analysing';
    case 'completed':
      return 'analysed';
    case 'skipped':
      return 'skipped';
    case 'failed':
      return 'failed';
    default:
      return 'not_analysed';
  }
}

async function syncPostAnalysisStatus(postId: string, assessmentStatus: string) {
  await prisma.post.update({
    where: { id: postId },
    data: { analysisStatus: analysisStatusForAssessment(assessmentStatus) },
  });
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

export function extractJson(raw: string) {
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

export function validateParsedAssessment(value: unknown): ParsedAiAssessment {
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

export function buildAssessmentPrompt(
  post: Awaited<ReturnType<typeof getPostForAssessment>>,
  members: Awaited<ReturnType<typeof getActiveMembers>>,
  promptTemplate: string,
) {
  const inputPayload = {
    post: postPromptData(post),
    referralMembers: members.map(referralMemberPromptData),
  };
  return {
    prompt: `${promptTemplate}

Assess this single post against the supplied referralMembers list only.
- The post author is not a referral candidate.
- recommendedMembers[].memberId must be an exact id from referralMembers.
- Never invent member IDs or resolve matches by display name.
- If the post is not looking_for_help, return an empty recommendedMembers array.`,
    userInput: `ASSESS_THIS_POST:\n${JSON.stringify(inputPayload, null, 2)}`,
    inputPayload,
  };
}

export function filterValidMemberMatches(
  recommendations: AiRecommendation[],
  members: Array<{ id: string }>,
  minMatchPercent: number,
) {
  const allowedIds = new Set(members.map((member) => member.id));
  const seen = new Set<string>();
  const threshold = Math.max(0, Math.min(100, minMatchPercent)) / 100;
  return recommendations
    .filter((match) => {
      if (!allowedIds.has(match.memberId)) return false;
      if (seen.has(match.memberId)) return false;
      seen.add(match.memberId);
      return parsePercent(match.scorePercent) >= threshold;
    })
    .map((match) => ({
      referralMemberId: match.memberId,
      score: parsePercent(match.scorePercent),
      scorePercent: normalisePercentString(match.scorePercent),
      reason: match.reason ?? null,
      suggestedIntro: match.suggestedIntro ?? null,
    }));
}

type MatchCandidate = {
  id: string;
  status: string;
  createdAt: Date;
  assessmentCreatedAt?: Date;
};

const AI_MATCH_STATUS_RANK: Record<string, number> = {
  introduced: 4,
  copied: 3,
  dismissed: 2,
  not_relevant: 2,
  new: 1,
};

/** Prefer workflow progress, then newest assessment, then newest match row. */
export function pickPreferredAiMemberMatch<T extends MatchCandidate>(matches: T[]): T {
  if (matches.length === 0) throw new Error('Cannot pick preferred match from empty list.');
  return matches.reduce((best, current) => {
    const rankDiff = (AI_MATCH_STATUS_RANK[current.status] ?? 0) - (AI_MATCH_STATUS_RANK[best.status] ?? 0);
    if (rankDiff !== 0) return rankDiff > 0 ? current : best;
    const assessmentDiff = (current.assessmentCreatedAt?.getTime() ?? 0) - (best.assessmentCreatedAt?.getTime() ?? 0);
    if (assessmentDiff !== 0) return assessmentDiff > 0 ? current : best;
    return current.createdAt >= best.createdAt ? current : best;
  });
}

type PersistedMemberMatch = {
  referralMemberId: string;
  score: number;
  scorePercent: string;
  reason: string | null;
  suggestedIntro: string | null;
};

/**
 * Keep at most one AiMemberMatch per post + referral member.
 * Reruns reuse the prior workflow status (copied/introduced/etc.) and refresh score/reason.
 */
async function syncAiMemberMatchesForPost(
  tx: Prisma.TransactionClient,
  assessmentId: string,
  postId: string,
  matches: PersistedMemberMatch[],
) {
  const existing = await tx.aiMemberMatch.findMany({
    where: { assessment: { postId } },
    include: { assessment: { select: { createdAt: true } } },
  });

  await tx.aiMemberMatch.deleteMany({ where: { assessmentId } });

  const remaining = existing.filter((row) => row.assessmentId !== assessmentId);
  const recommendedIds = new Set(matches.map((match) => match.referralMemberId));

  for (const match of matches) {
    const priors = remaining.filter((row) => row.referralMemberId === match.referralMemberId);
    if (priors.length === 0) {
      await tx.aiMemberMatch.create({ data: { assessmentId, ...match } });
      continue;
    }

    const keeper = pickPreferredAiMemberMatch(
      priors.map((row) => ({ ...row, assessmentCreatedAt: row.assessment.createdAt })),
    );
    await tx.aiMemberMatch.update({
      where: { id: keeper.id },
      data: {
        assessmentId,
        score: match.score,
        scorePercent: match.scorePercent,
        reason: match.reason,
        suggestedIntro: match.suggestedIntro,
      },
    });

    const dropIds = priors.filter((row) => row.id !== keeper.id).map((row) => row.id);
    if (dropIds.length > 0) {
      await tx.aiMemberMatch.deleteMany({ where: { id: { in: dropIds } } });
    }
  }

  const staleIds = remaining
    .filter((row) => !recommendedIds.has(row.referralMemberId) && row.status === 'new')
    .map((row) => row.id);
  if (staleIds.length > 0) {
    await tx.aiMemberMatch.deleteMany({ where: { id: { in: staleIds } } });
  }
}

/** One-time / startup cleanup for duplicate linked matches created by past AI reruns. */
export async function dedupeAiMemberMatches() {
  const matches = await prisma.aiMemberMatch.findMany({
    select: {
      id: true,
      assessmentId: true,
      referralMemberId: true,
      status: true,
      score: true,
      scorePercent: true,
      reason: true,
      suggestedIntro: true,
      createdAt: true,
      assessment: { select: { postId: true, createdAt: true } },
    },
  });

  const groups = new Map<string, typeof matches>();
  for (const match of matches) {
    const key = `${match.assessment.postId}:${match.referralMemberId}`;
    const list = groups.get(key) ?? [];
    list.push(match);
    groups.set(key, list);
  }

  let removed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const newestContent = [...group].sort(
      (a, b) => b.assessment.createdAt.getTime() - a.assessment.createdAt.getTime()
        || b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];
    const keeper = pickPreferredAiMemberMatch(
      group.map((row) => ({ ...row, assessmentCreatedAt: row.assessment.createdAt })),
    );
    const dropIds = group.filter((row) => row.id !== keeper.id).map((row) => row.id);

    await prisma.$transaction([
      prisma.aiMemberMatch.deleteMany({ where: { id: { in: dropIds } } }),
      prisma.aiMemberMatch.update({
        where: { id: keeper.id },
        data: {
          assessmentId: newestContent.assessmentId,
          score: newestContent.score,
          scorePercent: newestContent.scorePercent,
          reason: newestContent.reason,
          suggestedIntro: newestContent.suggestedIntro,
        },
      }),
    ]);
    removed += dropIds.length;
  }

  if (removed > 0) {
    logAiActivity({ level: 'info', message: `Removed ${removed} duplicate AI member match(es) for the same post + member.` });
  }
  return { removed, groups: groups.size };
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
  const providerHealth = await getProviderHealth(settings);
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
  const remoteConcurrency = settings.ai.remoteConcurrency;
  const effectiveConcurrency = effectiveConcurrencyFor(provider.provider, remoteConcurrency);
  return {
    enabled: settings.ai.enabled,
    autoAnalyse: settings.ai.autoAnalyse,
    provider: provider.provider,
    providerLabel: provider.label,
    model: provider.model,
    baseUrl: provider.baseUrl,
    ollamaBaseUrl: settings.ai.ollamaBaseUrl,
    ollamaReachable: reachable,
    providerHealth,
    counts: { pending, running, completed, failed, skipped },
    processorRunning,
    processorStartedAt,
    currentAssessmentId: currentAssessmentId(),
    currentPostUrl: currentPostUrl(),
    currentAssessmentIds: [...activeJobs.keys()],
    currentPostUrls: [...activeJobs.values()].filter((url): url is string => Boolean(url)),
    activeJobCount: activeJobs.size,
    remoteConcurrency,
    effectiveConcurrency,
    processedInCurrentRun,
    promptVersion: promptVersion(
      settings.ai.promptTemplate,
      `${provider.provider}:${provider.model}`,
      prefilterVersionKey(settings),
    ),
    oldestRunningStartedAt: oldestRunning?.startedAt,
    staleRunningThresholdSeconds: settings.ai.staleRunningSeconds,
    prefilterEnabled: settings.ai.prefilterEnabled,
  };
}

export function getAiActivity() {
  return {
    processorRunning,
    processorStartedAt,
    currentAssessmentId: currentAssessmentId(),
    currentPostUrl: currentPostUrl(),
    currentAssessmentIds: [...activeJobs.keys()],
    currentPostUrls: [...activeJobs.values()].filter((url): url is string => Boolean(url)),
    activeJobCount: activeJobs.size,
    processedInCurrentRun,
    items: aiActivity,
  };
}

export function eligiblePost(post: {
  canonicalPostUrl: string;
  latestCapturedText?: string | null;
  ocrText?: string | null;
  extractionConfidence?: number | null;
}, settings: Awaited<ReturnType<typeof getSettings>>) {
  if (!settings.ai.enabled) return { eligible: false, reason: 'ai_disabled', soft: false as const };
  if (settings.ai.requireRealFacebookPermalink && !isRealFacebookPostPermalink(post.canonicalPostUrl)) {
    return { eligible: false, reason: 'missing_real_permalink', soft: false as const };
  }
  if ((post.latestCapturedText ?? '').trim().length < POST_TEXT_MIN_LENGTH) {
    return { eligible: false, reason: 'missing_post_context', soft: false as const };
  }
  if ((post.extractionConfidence ?? 0) < settings.ai.minExtractionConfidence) {
    return { eligible: false, reason: 'low_extraction_confidence', soft: false as const };
  }
  if (settings.ai.prefilterEnabled) {
    const phrases = parseAiPrefilterPhrases(settings.ai.prefilterPhrases);
    if (phrases.length > 0) {
      const haystack = `${post.latestCapturedText ?? ''}\n${post.ocrText ?? ''}`;
      const match = matchesAiPrefilter(haystack, phrases);
      if (!match.matched) {
        return { eligible: false, reason: 'prefilter_no_match', soft: true as const };
      }
    }
  }
  return { eligible: true, reason: 'eligible', soft: false as const };
}

export async function queuePostForAi(postId: string, options: {
  force?: boolean;
  process?: boolean;
  /** When true, ignore the keyword pre-filter and send the post to the LLM. */
  bypassPrefilter?: boolean;
} = {}) {
  const settings = await getSettings();
  const post = await getPostForAssessment(postId);
  const provider = getProviderConfig(settings);
  const version = promptVersion(
    settings.ai.promptTemplate,
    `${provider.provider}:${provider.model}`,
    prefilterVersionKey(settings),
  );
  const eligibility = eligiblePost(post, settings);
  const bypassSoftFilter = Boolean(options.bypassPrefilter) && eligibility.soft;
  const willProcess = eligibility.eligible || bypassSoftFilter;

  if (!options.force) {
    const existing = await prisma.postAiAssessment.findFirst({
      where: {
        postId,
        promptVersion: version,
        status: willProcess ? { in: ['pending', 'running', 'completed'] } : { in: ['pending', 'running', 'completed', 'skipped'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return {
        queued: false,
        reason: existing.status === 'skipped' ? (existing.errorMessage || eligibility.reason) : `already_${existing.status}`,
        assessment: existing,
      };
    }
  }

  // Persist soft skips (pre-filter) so the queue shows why automation did not call the LLM.
  // Hard eligibility failures still return without creating a row.
  if (!willProcess && !eligibility.soft) {
    return { queued: false, reason: eligibility.reason };
  }

  const members = willProcess ? await getActiveMembers() : [];
  const skipSummary = willProcess ? null : describeSkipReason(eligibility.reason);
  const assessment = await prisma.postAiAssessment.create({
    data: {
      postId,
      status: willProcess ? 'pending' : 'skipped',
      provider: provider.provider,
      model: provider.model,
      promptVersion: version,
      promptText: settings.ai.promptTemplate,
      pricingSnapshot: provider.pricingSnapshot as unknown as object,
      summary: skipSummary,
      completedAt: willProcess ? null : new Date(),
      inputPayload: {
        queuedWith: {
          provider: provider.provider,
          providerLabel: provider.label,
          model: provider.model,
          baseUrl: provider.baseUrl,
          memberIds: members.map((member) => member.id),
          prefilter: {
            enabled: settings.ai.prefilterEnabled,
            bypassed: bypassSoftFilter,
            reason: eligibility.reason,
            phrases: settings.ai.prefilterEnabled ? parseAiPrefilterPhrases(settings.ai.prefilterPhrases) : [],
          },
        },
      },
      errorMessage: willProcess ? null : eligibility.reason,
    },
  });
  await syncPostAnalysisStatus(postId, assessment.status);
  if (!willProcess) {
    logAiActivity({
      level: 'info',
      message: `${describeSkipReason(eligibility.reason)} (${post.canonicalPostUrl})`,
      assessmentId: assessment.id,
      postUrl: post.canonicalPostUrl,
    });
  }
  if (options.process && assessment.status === 'pending') startAiQueueProcessor();
  return { queued: assessment.status === 'pending', reason: assessment.status === 'pending' ? 'pending' : eligibility.reason, assessment };
}

export async function queuePostAfterScrape(postId: string) {
  const settings = await getSettings();
  if (!settings.ai.enabled || !settings.ai.autoAnalyse) return { queued: false, reason: 'auto_analysis_disabled' };
  return queuePostForAi(postId, { process: true });
}

export async function requeueAssessment(assessmentId: string, options: {
  process?: boolean;
  bypassPrefilter?: boolean;
} = {}) {
  const existing = await prisma.postAiAssessment.findUnique({ where: { id: assessmentId } });
  if (!existing) throw new Error('Assessment not found.');
  if (!['failed', 'skipped'].includes(existing.status)) {
    throw new Error(`Only failed or skipped items can be re-queued (currently ${existing.status}).`);
  }

  const settings = await getSettings();
  const post = await getPostForAssessment(existing.postId);
  const provider = getProviderConfig(settings);
  const eligibility = eligiblePost(post, settings);
  const bypassSoftFilter = Boolean(options.bypassPrefilter) && eligibility.soft;
  const willProcess = eligibility.eligible || bypassSoftFilter;

  if (!willProcess && !eligibility.soft) {
    throw new Error(describeSkipReason(eligibility.reason));
  }

  if (!willProcess) {
    const skipped = await prisma.postAiAssessment.update({
      where: { id: assessmentId },
      data: {
        status: 'skipped',
        provider: provider.provider,
        model: provider.model,
        pricingSnapshot: provider.pricingSnapshot as unknown as object,
        summary: describeSkipReason(eligibility.reason),
        errorMessage: eligibility.reason,
        startedAt: null,
        completedAt: new Date(),
      },
    });
    await syncPostAnalysisStatus(existing.postId, 'skipped');
    logAiActivity({
      level: 'info',
      message: `Re-queue kept item skipped: ${describeSkipReason(eligibility.reason)}`,
      assessmentId,
      postUrl: post.canonicalPostUrl,
    });
    return { queued: false, reason: eligibility.reason, assessment: skipped };
  }

  const assessment = await prisma.postAiAssessment.update({
    where: { id: assessmentId },
    data: {
      status: 'pending',
      provider: provider.provider,
      model: provider.model,
      pricingSnapshot: provider.pricingSnapshot as unknown as object,
      promptVersion: promptVersion(
        settings.ai.promptTemplate,
        `${provider.provider}:${provider.model}`,
        prefilterVersionKey(settings),
      ),
      promptText: settings.ai.promptTemplate,
      errorMessage: null,
      summary: null,
      startedAt: null,
      completedAt: null,
    },
  });
  await syncPostAnalysisStatus(existing.postId, 'pending');
  logAiActivity({
    level: 'info',
    message: `Re-queued ${existing.status} assessment for ${post.canonicalPostUrl}`,
    assessmentId,
    postUrl: post.canonicalPostUrl,
  });
  if (options.process) startAiQueueProcessor();
  return { queued: true, reason: 'pending', assessment };
}

export async function requeueFailedAssessments(options: {
  limit?: number;
  process?: boolean;
  bypassPrefilter?: boolean;
  status?: 'failed' | 'skipped' | 'failed_or_skipped';
} = {}) {
  const limit = Math.max(1, Math.min(2000, Number(options.limit ?? 500)));
  const statusFilter = options.status === 'skipped'
    ? ['skipped']
    : options.status === 'failed_or_skipped'
      ? ['failed', 'skipped']
      : ['failed'];
  const items = await prisma.postAiAssessment.findMany({
    where: { status: { in: statusFilter } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true },
  });

  let queued = 0;
  let skipped = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const result = await requeueAssessment(item.id, {
        bypassPrefilter: options.bypassPrefilter,
      });
      if (result.queued) queued += 1;
      else skipped += 1;
    } catch {
      failed += 1;
    }
  }

  const processing = options.process !== false && queued > 0
    ? startAiQueueProcessor(Math.max(queued, 1))
    : undefined;
  logAiActivity({
    level: 'info',
    message: `Bulk re-queue inspected ${items.length}: queued ${queued}, still skipped ${skipped}, errors ${failed}.`,
  });
  return { inspected: items.length, queued, skipped, failed, processing };
}

export async function queueEligiblePosts(limit = 200, options: { force?: boolean; bypassPrefilter?: boolean } = {}) {
  return queueFilteredPostsForAi({
    limit,
    force: options.force,
    bypassPrefilter: options.bypassPrefilter,
  });
}

export interface AiRerunFilters {
  limit?: number;
  groupId?: string;
  reviewStatus?: string;
  analysisScope?: 'all' | 'not_analysed' | 'previously_analysed' | 'skipped_prefilter' | 'failed';
  discoveredWithinDays?: number;
  lastObservedWithinDays?: number;
  minExtractionConfidence?: number;
  search?: string;
  force?: boolean;
  bypassPrefilter?: boolean;
  process?: boolean;
}

export async function queueFilteredPostsForAi(filters: AiRerunFilters = {}) {
  const settings = await getSettings();
  const limit = Math.max(1, Math.min(2000, Number(filters.limit ?? 500)));
  const minConfidence = typeof filters.minExtractionConfidence === 'number' && Number.isFinite(filters.minExtractionConfidence)
    ? filters.minExtractionConfidence
    : settings.ai.minExtractionConfidence;

  const where: Prisma.PostWhereInput = {
    monitoringStatus: 'active',
    latestCapturedText: { not: null },
    extractionConfidence: { gte: minConfidence },
  };

  if (filters.groupId && filters.groupId !== 'all') where.groupId = filters.groupId;
  if (filters.reviewStatus && filters.reviewStatus !== 'all') where.reviewStatus = filters.reviewStatus;
  if (filters.search?.trim()) {
    const query = filters.search.trim();
    where.OR = [
      { latestCapturedText: { contains: query } },
      { authorName: { contains: query } },
      { canonicalPostUrl: { contains: query } },
    ];
  }
  if (typeof filters.discoveredWithinDays === 'number' && filters.discoveredWithinDays > 0) {
    where.firstDiscoveredAt = { gte: new Date(Date.now() - filters.discoveredWithinDays * 24 * 60 * 60 * 1000) };
  }
  if (typeof filters.lastObservedWithinDays === 'number' && filters.lastObservedWithinDays > 0) {
    where.lastObservedAt = { gte: new Date(Date.now() - filters.lastObservedWithinDays * 24 * 60 * 60 * 1000) };
  }

  switch (filters.analysisScope) {
    case 'not_analysed':
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        { aiAssessments: { none: { status: 'completed' } } },
      ];
      break;
    case 'previously_analysed':
      where.aiAssessments = { some: { status: 'completed' } };
      break;
    case 'skipped_prefilter':
      where.aiAssessments = { some: { status: 'skipped', errorMessage: 'prefilter_no_match' } };
      break;
    case 'failed':
      where.aiAssessments = { some: { status: 'failed' } };
      break;
    default:
      break;
  }

  const posts = await prisma.post.findMany({
    where,
    orderBy: { firstDiscoveredAt: 'desc' },
    take: limit,
    select: { id: true },
  });

  let queued = 0;
  let skipped = 0;
  let failed = 0;
  const reasons: Record<string, number> = {};
  for (const post of posts) {
    try {
      const result = await queuePostForAi(post.id, {
        force: filters.force,
        bypassPrefilter: filters.bypassPrefilter,
      });
      const reason = typeof result.reason === 'string' ? result.reason : 'unknown';
      reasons[reason] = (reasons[reason] ?? 0) + 1;
      if (result.queued) queued += 1;
      else skipped += 1;
    } catch {
      failed += 1;
      reasons.error = (reasons.error ?? 0) + 1;
    }
  }

  const processing = filters.process && queued > 0 ? startAiQueueProcessor(Math.max(queued, 1)) : undefined;
  logAiActivity({
    level: 'info',
    message: `Filtered AI rerun inspected ${posts.length}: queued ${queued}, skipped ${skipped}, failed ${failed}. Prefilter ${filters.bypassPrefilter ? 'bypassed' : 'applied'}.`,
  });
  return {
    inspected: posts.length,
    queued,
    skipped,
    failed,
    reasons,
    applyPrefilter: !filters.bypassPrefilter,
    processing,
  };
}

function providerFromAssessment(assessment: { provider?: string | null; model?: string | null; pricingSnapshot?: unknown }, settings: Awaited<ReturnType<typeof getSettings>>): ProviderRuntimeConfig {
  const snapshot = assessment.pricingSnapshot as AiPricingSnapshot | null | undefined;
  if (snapshot?.provider && snapshot.model) {
    return {
      provider: snapshot.provider,
      label: snapshot.providerLabel || providerLabel(snapshot.provider),
      model: snapshot.model,
      baseUrl: snapshot.baseUrl,
      pricing: {
        inputCostPerMillion: snapshot.inputCostPerMillion ?? 0,
        cachedInputCostPerMillion: snapshot.cachedInputCostPerMillion ?? 0,
        outputCostPerMillion: snapshot.outputCostPerMillion ?? 0,
      },
      pricingSnapshot: snapshot,
    };
  }
  return getProviderConfig(settings);
}

export async function runAssessment(assessmentId: string) {
  const settings = await getSettings();
  const existing = await prisma.postAiAssessment.findUnique({ where: { id: assessmentId } });
  if (!existing) throw new Error('Assessment not found.');
  const provider = providerFromAssessment(existing, settings);
  const assessment = await prisma.postAiAssessment.update({
    where: { id: assessmentId },
    data: {
      status: 'running',
      startedAt: new Date(),
      errorMessage: null,
      provider: provider.provider,
      model: provider.model,
      pricingSnapshot: provider.pricingSnapshot as unknown as object,
    },
  });
  await syncPostAnalysisStatus(assessment.postId, 'running');
  let rawText: unknown;
  let prompt: string | undefined;
  let inputPayload: unknown;
  let usage: AiUsageMetrics = {};
  try {
    const version = existing.promptVersion || promptVersion(settings.ai.promptTemplate, `${provider.provider}:${provider.model}`);
    const post = await getPostForAssessment(assessment.postId);
    activeJobs.set(assessmentId, post.canonicalPostUrl);
    logAiActivity({ level: 'info', message: `Started assessment for ${post.canonicalPostUrl} via ${provider.label}/${provider.model}`, assessmentId, postUrl: post.canonicalPostUrl });
    const members = await getActiveMembers();
    const built = buildAssessmentPrompt(post, members, existing.promptText || settings.ai.promptTemplate);
    prompt = built.prompt;
    inputPayload = built.inputPayload;
    const result = await callAiProvider(built.prompt, built.userInput, provider, settings.ai.requestTimeoutSeconds);
    usage = result.usage;
    rawText = result.text;
    const parsed = validateParsedAssessment(extractJson(result.text));
    const validMatches = filterValidMemberMatches(
      parsed.intent === 'looking_for_help' ? parsed.recommendedMembers : [],
      members,
      settings.ai.minMatchPercent,
    );
    const finalParsed: ParsedAiAssessment = {
      ...parsed,
      recommendedMembers: validMatches.map((match) => ({
        memberId: match.referralMemberId,
        scorePercent: match.scorePercent,
        reason: match.reason ?? undefined,
        suggestedIntro: match.suggestedIntro ?? undefined,
      })),
      isReferralOpportunity: parsed.intent === 'looking_for_help' && validMatches.length > 0,
    };

    await prisma.$transaction(async (tx) => {
      await tx.postAiAssessment.update({
        where: { id: assessmentId },
        data: {
          status: 'completed',
          provider: provider.provider,
          model: provider.model,
          inputTokens: usage.inputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          requestCount: usage.requestCount ?? 1,
          estimatedCostUsd: usage.estimatedCostUsd,
          durationMs: usage.durationMs,
          pricingSnapshot: provider.pricingSnapshot as unknown as object,
          promptVersion: version,
          promptText: existing.promptText || settings.ai.promptTemplate,
          renderedPrompt: prompt,
          inputPayload: inputPayload as unknown as object,
          rawResponse: rawText as object,
          parsed: finalParsed as unknown as object,
          intent: finalParsed.intent,
          isReferralOpportunity: finalParsed.isReferralOpportunity,
          confidence: finalParsed.confidence,
          summary: finalParsed.summary,
          completedAt: new Date(),
          errorMessage: null,
        },
      });
      await syncAiMemberMatchesForPost(tx, assessmentId, assessment.postId, validMatches);
    });
    await syncPostAnalysisStatus(assessment.postId, 'completed');
    logAiActivity({
      level: 'info',
      message: `Completed assessment as ${finalParsed.intent}${finalParsed.isReferralOpportunity ? ' with referral match' : ''}.`,
      assessmentId,
      postUrl: post.canonicalPostUrl,
    });
    return { status: 'completed', parsed: finalParsed };
  } catch (error) {
    const post = await prisma.post.findUnique({ where: { id: assessment.postId }, select: { canonicalPostUrl: true } });
    const message = error instanceof Error && error.name === 'TimeoutError'
      ? `${provider.label} timed out after ${settings.ai.requestTimeoutSeconds}s.`
      : error instanceof Error ? error.message : String(error);
    const failureData: Prisma.PostAiAssessmentUpdateInput = {
      status: 'failed',
      errorMessage: message,
      completedAt: new Date(),
      provider: provider.provider,
      model: provider.model,
      pricingSnapshot: provider.pricingSnapshot as unknown as object,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      requestCount: usage.requestCount,
      estimatedCostUsd: usage.estimatedCostUsd,
      durationMs: usage.durationMs,
    };
    if (rawText) failureData.rawResponse = rawText as object;
    if (prompt) failureData.renderedPrompt = prompt;
    if (inputPayload) failureData.inputPayload = inputPayload as unknown as object;
    await prisma.postAiAssessment.update({
      where: { id: assessmentId },
      data: failureData,
    });
    await syncPostAnalysisStatus(assessment.postId, 'failed');
    logAiActivity({ level: 'error', message: `Assessment failed: ${message}`, assessmentId, postUrl: post?.canonicalPostUrl });
    return { status: 'failed', error: message };
  } finally {
    activeJobs.delete(assessmentId);
  }
}

async function claimNextPendingAssessment() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = await prisma.postAiAssessment.findFirst({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!candidate) return undefined;
    const claimed = await prisma.postAiAssessment.updateMany({
      where: { id: candidate.id, status: 'pending' },
      data: {
        status: 'running',
        startedAt: new Date(),
        errorMessage: null,
      },
    });
    if (claimed.count === 1) return candidate.id;
  }
  return undefined;
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
  activeJobs.clear();
  const maxItems = Math.max(1, Math.min(10000, limit));
  let started = 0;
  let processed = 0;
  const results: Array<{ status: string; parsed?: unknown; error?: string }> = [];
  try {
    await resetOrphanedRunningAssessments('Re-queued before starting a new AI processor.');
    const settings = await getSettings();
    const provider = getProviderConfig(settings);
    const concurrency = effectiveConcurrencyFor(provider.provider, settings.ai.remoteConcurrency);
    logAiActivity({
      level: 'info',
      message: `AI processor started with limit ${maxItems} and concurrency ${concurrency} (${provider.label}).`,
    });
    if (provider.provider === 'ollama') {
      const ollama = await ensureOllamaRunning(settings);
      if (!ollama.reachable) throw new Error('Ollama is not reachable. Install/start Ollama and pull the configured model.');
    } else {
      if (!provider.baseUrl || !provider.model) throw new Error(`Configure a base URL and model for ${provider.label}.`);
      if (!await getProviderApiKey(provider.provider)) throw new Error(`No ${provider.label} API key is saved. Add it in Settings before processing the queue.`);
    }

    const active = new Set<Promise<void>>();
    let drained = false;
    while ((!drained && started < maxItems) || active.size > 0) {
      while (!drained && started < maxItems && active.size < concurrency) {
        const assessmentId = await claimNextPendingAssessment();
        if (!assessmentId) {
          drained = true;
          break;
        }
        started += 1;
        let task!: Promise<void>;
        task = (async () => {
          results.push(await runAssessment(assessmentId));
          processed += 1;
          processedInCurrentRun = processed;
        })().finally(() => {
          active.delete(task);
        });
        active.add(task);
      }
      if (active.size > 0) await Promise.race(active);
    }

    logAiActivity({ level: 'info', message: `AI processor stopped after processing ${processed} item(s) with concurrency ${concurrency}.` });
    return { started: true, processed, concurrency, drained: drained || processed < maxItems, results };
  } finally {
    processorRunning = false;
    processorStartedAt = undefined;
    activeJobs.clear();
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

function emptyTotals(): AiUsageTotals {
  return {
    requestCount: 0,
    assessmentCount: 0,
    completedCount: 0,
    failedCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    averageLatencyMs: null,
  };
}

function accumulate(target: AiUsageTotals, row: {
  status: string;
  requestCount?: number | null;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  estimatedCostUsd?: number | null;
  durationMs?: number | null;
}, latencyBucket: { sum: number; count: number }) {
  target.assessmentCount += 1;
  target.requestCount += row.requestCount ?? (row.status === 'completed' || row.status === 'failed' ? 1 : 0);
  if (row.status === 'completed') target.completedCount += 1;
  if (row.status === 'failed') target.failedCount += 1;
  target.inputTokens += row.inputTokens ?? 0;
  target.cachedInputTokens += row.cachedInputTokens ?? 0;
  target.outputTokens += row.outputTokens ?? 0;
  target.totalTokens += row.totalTokens ?? 0;
  target.estimatedCostUsd += row.estimatedCostUsd ?? 0;
  if (typeof row.durationMs === 'number') {
    latencyBucket.sum += row.durationMs;
    latencyBucket.count += 1;
  }
}

export async function getAiUsageReport(filters: {
  from?: string;
  to?: string;
  provider?: string;
  model?: string;
} = {}): Promise<AiUsageReport> {
  const to = filters.to ? new Date(filters.to) : new Date();
  const from = filters.from ? new Date(filters.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new Error('Provide valid from/to dates.');
  const where: Prisma.PostAiAssessmentWhereInput = {
    createdAt: { gte: from, lte: to },
    status: { in: ['completed', 'failed'] },
  };
  if (filters.provider && filters.provider !== 'all') where.provider = filters.provider;
  if (filters.model && filters.model !== 'all') where.model = filters.model;

  const rows = await prisma.postAiAssessment.findMany({
    where,
    select: {
      status: true,
      provider: true,
      model: true,
      requestCount: true,
      inputTokens: true,
      cachedInputTokens: true,
      outputTokens: true,
      totalTokens: true,
      estimatedCostUsd: true,
      durationMs: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const totals = emptyTotals();
  const totalsLatency = { sum: 0, count: 0 };
  const byProviderModel = new Map<string, AiUsageByProviderModel & { _latency: { sum: number; count: number } }>();
  const byDay = new Map<string, AiUsageByDay & { _latency: { sum: number; count: number } }>();

  for (const row of rows) {
    accumulate(totals, row, totalsLatency);
    const provider = row.provider ?? 'ollama';
    const model = row.model ?? 'unknown';
    const key = `${provider}::${model}`;
    if (!byProviderModel.has(key)) {
      byProviderModel.set(key, {
        provider,
        providerLabel: provider === 'openai' || provider === 'xai' || provider === 'custom' || provider === 'ollama'
          ? providerLabel(provider)
          : provider,
        model,
        ...emptyTotals(),
        _latency: { sum: 0, count: 0 },
      });
    }
    const providerBucket = byProviderModel.get(key)!;
    accumulate(providerBucket, row, providerBucket._latency);

    const date = row.createdAt.toISOString().slice(0, 10);
    if (!byDay.has(date)) {
      byDay.set(date, { date, ...emptyTotals(), _latency: { sum: 0, count: 0 } });
    }
    const dayBucket = byDay.get(date)!;
    accumulate(dayBucket, row, dayBucket._latency);
  }

  totals.averageLatencyMs = totalsLatency.count ? totalsLatency.sum / totalsLatency.count : null;
  const byProviderModelList = [...byProviderModel.values()].map(({ _latency, ...rest }) => ({
    ...rest,
    averageLatencyMs: _latency.count ? _latency.sum / _latency.count : null,
  })).sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd || b.totalTokens - a.totalTokens);
  const byDayList = [...byDay.values()].map(({ _latency, ...rest }) => ({
    ...rest,
    averageLatencyMs: _latency.count ? _latency.sum / _latency.count : null,
  })).sort((a, b) => a.date.localeCompare(b.date));

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    totals,
    byProviderModel: byProviderModelList,
    byDay: byDayList,
  };
}
