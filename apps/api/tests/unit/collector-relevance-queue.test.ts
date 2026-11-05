import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  settings:vi.fn(), provider:vi.fn(),
  db:{ post:{findUnique:vi.fn(),update:vi.fn()}, postAiAssessment:{findFirst:vi.fn(),create:vi.fn(),updateMany:vi.fn()}, referralMember:{findMany:vi.fn()} },
}));
vi.mock('../../src/db/prisma.js',()=>({prisma:mocks.db}));
vi.mock('../../src/services/settings.service.js',async original=>({ ...await original<typeof import('../../src/services/settings.service.js')>(), getSettings:mocks.settings }));
vi.mock('../../src/services/ai-provider.service.js',async original=>({ ...await original<typeof import('../../src/services/ai-provider.service.js')>(), callAiProvider:mocks.provider, ensureOllamaRunning:vi.fn().mockResolvedValue({reachable:true}) }));
import { queuePostForAi, processAiQueue, startAiQueueProcessor, buildAssessmentPrompt } from '../../src/services/ai-assessment.service.js';
import { defaultSettings, normalizeSettings } from '../../src/services/settings.service.js';
const post = {id:'collector-post-123-456',groupId:'g1',facebookPostId:'456',canonicalPostUrl:'https://www.facebook.com/groups/123/posts/456',extractionStrategy:'facebook_gql',extractionConfidence:0,latestCapturedText:'Can anyone recommend a reliable local plumber?',group:{friendlyName:'Example',canonicalGroupUrl:'https://www.facebook.com/groups/123'}};
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue(normalizeSettings({ai:{...defaultSettings.ai,prefilterEnabled:true,prefilterPhrases:'looking for\ncan anyone',minExtractionConfidence:0.9}}));
  mocks.db.post.findUnique.mockResolvedValue(post);
  mocks.db.postAiAssessment.findFirst.mockResolvedValue(null);
  mocks.db.postAiAssessment.updateMany.mockResolvedValue({count:0});
  mocks.db.postAiAssessment.create.mockImplementation(async ({data})=>({id:'a1',...data}));
  mocks.db.referralMember.findMany.mockResolvedValue([{id:'m1'}]);
});
describe('collector relevance queue',()=>{
  it('rechecks pending work when an enqueue wakes a draining processor',async()=>{
    mocks.db.postAiAssessment.findFirst.mockImplementationOnce(async()=>{
      startAiQueueProcessor(); // arrival after the empty claim has begun
      return null;
    }).mockResolvedValue(null);
    await processAiQueue(10);
    expect(mocks.db.postAiAssessment.findFirst).toHaveBeenCalledTimes(2);
  });
  it('assembles the full post and member profiles, not just queue member IDs',()=>{
    const member={id:'m1',name:'Heating specialist',category:'Heating Engineer',keywords:'boiler service',servicesOffered:'Domestic boiler servicing'};
    const built=buildAssessmentPrompt(post as never,[member] as never,'Assess relevance');
    expect(built.inputPayload.post.text).toBe(post.latestCapturedText);
    expect(built.inputPayload.referralMembers[0]).toMatchObject(member);
    expect(built.userInput).toContain('Domestic boiler servicing');
  });
  it('persists the matched phrase and queues eligible structured posts',async()=>{
    const result=await queuePostForAi(post.id,{process:false});
    expect(result.queued).toBe(true);
    expect(mocks.db.postAiAssessment.create.mock.calls[0][0].data).toMatchObject({status:'pending',inputPayload:{queuedWith:{memberIds:['m1'],prefilter:{reason:'eligible',matchedPhrase:'can anyone'}}}});
    expect(mocks.db.post.update).toHaveBeenCalledWith({where:{id:post.id},data:{analysisStatus:'queued'}});
  });
  it('persists an explained prefilter skip without loading members or calling a provider',async()=>{
    mocks.db.post.findUnique.mockResolvedValue({...post,latestCapturedText:'Our plumbing services are on sale this weekend.'});
    const result=await queuePostForAi(post.id,{process:false});
    expect(result).toMatchObject({queued:false,reason:'prefilter_no_match'});
    expect(mocks.db.postAiAssessment.create.mock.calls[0][0].data).toMatchObject({status:'skipped',errorMessage:'prefilter_no_match'});
    expect(mocks.db.referralMember.findMany).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it('does not create another assessment for an already queued/completed post on replay',async()=>{
    mocks.db.postAiAssessment.findFirst.mockResolvedValue({id:'a1',status:'completed'});
    expect(await queuePostForAi(post.id,{process:false})).toMatchObject({queued:false,reason:'already_completed'});
    expect(mocks.db.postAiAssessment.create).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });
});
