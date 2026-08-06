import { describe, expect, it } from 'vitest';
import { matchesAiPrefilter, parseAiPrefilterPhrases } from '@local-group-monitor/shared';
import { describeSkipReason, eligiblePost } from '../../src/services/ai-assessment.service.js';
import { defaultSettings, normalizeSettings } from '../../src/services/settings.service.js';

describe('AI pre-filter phrases', () => {
  it('parses newline and comma separated phrases', () => {
    expect(parseAiPrefilterPhrases('looking for\ncan anyone, recommend')).toEqual([
      'looking for',
      'can anyone',
      'recommend',
    ]);
  });

  it('matches help-seeking language and rejects adverts', () => {
    expect(matchesAiPrefilter('Can anyone recommend a roofer?', 'looking for\ncan anyone')).toEqual({
      matched: true,
      matchedPhrase: 'can anyone',
    });
    expect(matchesAiPrefilter('We are advertising our roofing services this week.', 'looking for\ncan anyone').matched).toBe(false);
  });
});

describe('AI queue eligibility pre-filter', () => {
  const post = {
    canonicalPostUrl: 'https://www.facebook.com/groups/abc/posts/123',
    latestCapturedText: 'Looking for a reliable mortgage broker in Bracknell',
    extractionConfidence: 0.95,
  };

  it('allows matching posts when pre-filter is enabled', () => {
    const settings = normalizeSettings({
      ai: {
        ...defaultSettings.ai,
        prefilterEnabled: true,
        prefilterPhrases: 'looking for\ncan anyone',
        requireRealFacebookPermalink: true,
      },
    });
    expect(eligiblePost(post, settings)).toMatchObject({ eligible: true, reason: 'eligible' });
  });

  it('soft-rejects posts with no phrase match', () => {
    const settings = normalizeSettings({
      ai: {
        ...defaultSettings.ai,
        prefilterEnabled: true,
        prefilterPhrases: 'can anyone\nrecommend',
        requireRealFacebookPermalink: true,
      },
    });
    expect(eligiblePost({
      ...post,
      latestCapturedText: 'Just sold my house and wanted to say thanks to the group!',
    }, settings)).toEqual({ eligible: false, reason: 'prefilter_no_match', soft: true });
  });

  it('skips pre-filter when disabled', () => {
    const settings = normalizeSettings({
      ai: {
        ...defaultSettings.ai,
        prefilterEnabled: false,
        prefilterPhrases: 'zzzz-no-match',
        requireRealFacebookPermalink: true,
      },
    });
    expect(eligiblePost({
      ...post,
      latestCapturedText: 'General chat with no help request language',
    }, settings).eligible).toBe(true);
  });

  it('describes pre-filter skips clearly for the queue UI', () => {
    expect(describeSkipReason('prefilter_no_match')).toContain('no pre-filter trigger phrase matched');
    expect(describeSkipReason('prefilter_no_match')).toContain('not sent to the LLM');
  });
});
