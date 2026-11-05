import { describe, expect, it } from 'vitest';
import { estimateUsdCost, findCuratedModel, ZERO_PRICING } from '@local-group-monitor/shared';
import { normalizeSettings } from '../../src/services/settings.service.js';
import {
  buildAssessmentPrompt,
  extractJson,
  filterValidMemberMatches,
  pickPreferredAiMemberMatch,
  validateParsedAssessment,
} from '../../src/services/ai-assessment.service.js';
import { getProviderConfig } from '../../src/services/ai-provider.service.js';

describe('AI settings normalization', () => {
  it('defaults provider to ollama and migrates legacy timeout', () => {
    const settings = normalizeSettings({
      ai: {
        ollamaRequestTimeoutSeconds: 240,
      },
    });
    expect(settings.ai.provider).toBe('ollama');
    expect(settings.ai.requestTimeoutSeconds).toBe(240);
    expect(settings.ai.openaiModel).toBe('gpt-6-luna');
    expect(settings.ai.remoteConcurrency).toBe(5);
  });

  it('clamps remote concurrency between 1 and 20', () => {
    expect(normalizeSettings({ ai: { remoteConcurrency: 0 } }).ai.remoteConcurrency).toBe(1);
    expect(normalizeSettings({ ai: { remoteConcurrency: 99 } }).ai.remoteConcurrency).toBe(20);
    expect(normalizeSettings({ ai: { remoteConcurrency: 8 } }).ai.remoteConcurrency).toBe(8);
  });

  it('keeps custom remote pricing fields', () => {
    const settings = normalizeSettings({
      ai: {
        provider: 'openai',
        openaiModel: '__custom__',
        openaiCustomModel: 'gpt-test',
        openaiCustomInputCostPerMillion: 1.5,
        openaiCustomCachedInputCostPerMillion: 0.1,
        openaiCustomOutputCostPerMillion: 2.5,
      },
    });
    const provider = getProviderConfig(settings);
    expect(provider.model).toBe('gpt-test');
    expect(provider.pricing.inputCostPerMillion).toBe(1.5);
    expect(provider.pricing.cachedInputCostPerMillion).toBe(0.1);
    expect(provider.pricing.outputCostPerMillion).toBe(2.5);
  });
});

describe('AI pricing catalog', () => {
  it('uses corrected OpenAI Luna rates', () => {
    const luna = findCuratedModel('openai', 'gpt-5.6-luna');
    expect(luna?.inputCostPerMillion).toBe(0.2);
    expect(luna?.outputCostPerMillion).toBe(1.2);
    expect(estimateUsdCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, luna!)).toBeCloseTo(1.4);
  });

  it('estimates cached input at the cached rate', () => {
    const cost = estimateUsdCost(
      { inputTokens: 1000, cachedInputTokens: 400, outputTokens: 100 },
      { inputCostPerMillion: 1, cachedInputCostPerMillion: 0.1, outputCostPerMillion: 2 },
    );
    expect(cost).toBeCloseTo((600 * 1 + 400 * 0.1 + 100 * 2) / 1_000_000);
  });

  it('keeps local pricing at zero', () => {
    expect(estimateUsdCost({ inputTokens: 100, outputTokens: 50 }, ZERO_PRICING)).toBe(0);
  });
});

describe('AI assessment parsing and member ID enforcement', () => {
  it('extracts JSON from fenced model output', () => {
    const parsed = validateParsedAssessment(extractJson('```json\n{"intent":"looking_for_help","isReferralOpportunity":true,"confidence":0.9,"summary":"Need plumber","recommendedMembers":[{"memberId":"m1","scorePercent":"80%","reason":"fit","suggestedIntro":"hi"}]}\n```'));
    expect(parsed.intent).toBe('looking_for_help');
    expect(parsed.recommendedMembers[0]?.memberId).toBe('m1');
  });

  it('rejects invented or duplicate member IDs', () => {
    const matches = filterValidMemberMatches(
      [
        { memberId: 'real-1', scorePercent: '90%' },
        { memberId: 'invented', scorePercent: '99%' },
        { memberId: 'real-1', scorePercent: '80%' },
        { memberId: 'real-2', scorePercent: '10%' },
      ],
      [{ id: 'real-1' }, { id: 'real-2' }],
      20,
    );
    expect(matches.map((match) => match.referralMemberId)).toEqual(['real-1']);
  });

  it('builds a single-call prompt with post and all members', () => {
    const built = buildAssessmentPrompt(
      {
        id: 'post-1',
        group: { friendlyName: 'Test Group' },
        authorName: 'Ross',
        canonicalPostUrl: 'https://www.facebook.com/groups/abc/posts/123',
        latestCapturedText: 'Looking for a plumber',
        ocrText: null,
      } as never,
      [
        {
          id: 'member-stephen',
          name: 'Stephen',
          businessName: 'Pipes Ltd',
          facebookName: null,
          facebookProfileUrl: null,
          category: 'Plumbing',
          keywords: 'plumber',
          servicesOffered: 'Plumbing',
          idealReferral: 'Emergency plumbing',
          negativeKeywords: null,
        },
      ] as never,
      'Assess posts.',
    );
    expect(built.userInput).toContain('ASSESS_THIS_POST');
    expect(built.userInput).toContain('member-stephen');
    expect(built.userInput).toContain('Looking for a plumber');
    expect(built.prompt).toContain('exact id from referralMembers');
  });
});

describe('pickPreferredAiMemberMatch', () => {
  it('keeps introduced/copied status over a newer new match', () => {
    const preferred = pickPreferredAiMemberMatch([
      { id: 'old-introduced', status: 'introduced', createdAt: new Date('2026-08-01T10:00:00Z'), assessmentCreatedAt: new Date('2026-08-01T10:00:00Z') },
      { id: 'new-rerun', status: 'new', createdAt: new Date('2026-08-05T10:00:00Z'), assessmentCreatedAt: new Date('2026-08-05T10:00:00Z') },
    ]);
    expect(preferred.id).toBe('old-introduced');
  });

  it('prefers the newest assessment when statuses match', () => {
    const preferred = pickPreferredAiMemberMatch([
      { id: 'older', status: 'new', createdAt: new Date('2026-08-01T10:00:00Z'), assessmentCreatedAt: new Date('2026-08-01T10:00:00Z') },
      { id: 'newer', status: 'new', createdAt: new Date('2026-08-05T10:00:00Z'), assessmentCreatedAt: new Date('2026-08-05T10:00:00Z') },
    ]);
    expect(preferred.id).toBe('newer');
  });
});
