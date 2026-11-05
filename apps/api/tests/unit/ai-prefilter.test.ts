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
    expect(eligiblePost(post, settings)).toMatchObject({
      eligible: true,
      reason: 'eligible',
      matchedPhrase: 'looking for',
    });
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

  it('allows hash-fallback posts through the prefilter despite low extraction confidence', () => {
    const settings = normalizeSettings({
      ai: {
        ...defaultSettings.ai,
        prefilterEnabled: true,
        prefilterPhrases: 'looking for\ncan anyone',
        requireRealFacebookPermalink: true,
        minExtractionConfidence: 0.8,
      },
    });
    expect(eligiblePost({
      canonicalPostUrl: 'https://www.facebook.com/groups/abc#post-a1b2c3d4e5f67890',
      latestCapturedText: 'Looking for a reliable electrician in Bracknell',
      extractionConfidence: 0.45,
      extractionStrategy: 'text_hash_fallback',
    }, settings)).toMatchObject({ eligible: true, reason: 'eligible' });
  });

  it('soft-skips hash-fallback posts that do not match trigger phrases', () => {
    const settings = normalizeSettings({
      ai: {
        ...defaultSettings.ai,
        prefilterEnabled: true,
        prefilterPhrases: 'looking for\ncan anyone',
        minExtractionConfidence: 0.8,
      },
    });
    expect(eligiblePost({
      canonicalPostUrl: 'https://www.facebook.com/groups/abc#post-a1b2c3d4e5f67890',
      latestCapturedText: "You can't buy happiness, but you can buy cake",
      extractionConfidence: 0.45,
      extractionStrategy: 'text_hash_fallback',
    }, settings)).toEqual({ eligible: false, reason: 'prefilter_no_match', soft: true });
  });

  it('still enforces confidence for real-permalink posts', () => {
    const settings = normalizeSettings({
      ai: {
        ...defaultSettings.ai,
        prefilterEnabled: false,
        minExtractionConfidence: 0.8,
      },
    });
    expect(eligiblePost({
      canonicalPostUrl: 'https://www.facebook.com/groups/abc/posts/123',
      latestCapturedText: 'Looking for a plumber please',
      extractionConfidence: 0.45,
    }, settings)).toEqual({ eligible: false, reason: 'low_extraction_confidence', soft: false });
  });

  it('blocks hash-fallback posts with insufficient text', () => {
    const settings = normalizeSettings({
      ai: {
        ...defaultSettings.ai,
        prefilterEnabled: false,
        minExtractionConfidence: 0.8,
      },
    });
    expect(eligiblePost({
      canonicalPostUrl: 'https://www.facebook.com/groups/abc#post-a1b2c3d4e5f67890',
      latestCapturedText: 'Hi there',
      extractionConfidence: 0.45,
      extractionStrategy: 'text_hash_fallback',
    }, settings)).toEqual({ eligible: false, reason: 'missing_post_context', soft: false });
  });
});


describe('structured collector relevance', () => {
  const settings = normalizeSettings({ ai:{ ...defaultSettings.ai, minExtractionConfidence:0.9, prefilterEnabled:true, prefilterPhrases:'looking for\ncan anyone' } });
  const post = { canonicalPostUrl:'https://www.facebook.com/groups/123/posts/456', facebookPostId:'456', extractionStrategy:'facebook_gql', extractionConfidence:0, latestCapturedText:'Can anyone recommend a reliable local plumber?' };
  it('checks valid structured text against the phrase filter without inventing a DOM score', () => {
    expect(eligiblePost(post,settings)).toMatchObject({eligible:true,matchedPhrase:'can anyone'});
    expect(post.extractionConfidence).toBe(0);
  });
  it('skips adverts before calling the LLM', () => {
    expect(eligiblePost({...post,latestCapturedText:'Our plumbing services are on sale this weekend.'},settings)).toMatchObject({eligible:false,reason:'prefilter_no_match',soft:true});
  });
  it('rejects mismatched source identities', () => {
    expect(eligiblePost({...post,facebookPostId:'999'},settings)).toMatchObject({eligible:false,reason:'invalid_collector_identity',soft:false});
    expect(eligiblePost({...post,canonicalPostUrl:'https://www.facebook.com/groups/123'},settings).eligible).toBe(false);
  });
  it('still requires enough text and honours disabled AI', () => {
    expect(eligiblePost({...post,latestCapturedText:'Hi'},settings).reason).toBe('missing_post_context');
    expect(eligiblePost(post,normalizeSettings({ai:{...settings.ai,enabled:false}})).reason).toBe('ai_disabled');
  });
});
