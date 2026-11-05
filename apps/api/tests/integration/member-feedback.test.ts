import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {summarizeMemberFeedback,reviewMemberMatch,listMemberFeedback,setMemberFeedbackActive,feedbackForPrompt,isRejectedExample} from '../../src/services/member-feedback.service.js';
let dir:string,db:PrismaClient;
beforeAll(async()=>{
 dir=await mkdtemp(path.join(os.tmpdir(),'member-feedback-'));db=new PrismaClient({datasourceUrl:`file:${path.join(dir,'test.sqlite')}`});
 const sql=[
 'CREATE TABLE Setting(key TEXT PRIMARY KEY,value JSONB NOT NULL,updatedAt DATETIME NOT NULL)',
 'CREATE TABLE ReferralMember(id TEXT PRIMARY KEY,name TEXT,category TEXT,servicesOffered TEXT,idealReferral TEXT)',
 'CREATE TABLE Post(id TEXT PRIMARY KEY,canonicalPostUrl TEXT,latestCapturedText TEXT,firstCapturedText TEXT)',
 'CREATE TABLE PostAiAssessment(id TEXT PRIMARY KEY,postId TEXT)',
 'CREATE TABLE AiMemberMatch(id TEXT PRIMARY KEY,assessmentId TEXT,referralMemberId TEXT,reason TEXT,status TEXT,note TEXT,copiedAt DATETIME,introducedAt DATETIME,dismissedAt DATETIME)',
 'CREATE TABLE NotificationDelivery(id TEXT PRIMARY KEY,postId TEXT,referralMemberId TEXT,status TEXT,errorMessage TEXT,updatedAt DATETIME)',
 "INSERT INTO ReferralMember VALUES ('m1','Kitchen specialist','Kitchens','Design and installation','Kitchen renovations'),('m2','Other member','Removals','Transport','Moving house')",
 "INSERT INTO Post VALUES ('p1','https://www.facebook.com/groups/1/posts/2','Can anyone transport my desk?',NULL),('p2','https://www.facebook.com/groups/1/posts/3','Anyone need kitchen advice?',NULL)",
 "INSERT INTO PostAiAssessment VALUES ('a1','p1'),('a2','p2')",
 "INSERT INTO AiMemberMatch VALUES ('x1','a1','m1','Works with homes','new',NULL,NULL,NULL,NULL),('x2','a2','m1','Kitchen expertise','new',NULL,NULL,NULL,NULL)",
 "INSERT INTO NotificationDelivery VALUES ('d1','p1','m1','pending',NULL,1),('d2','p1','m1','sent',NULL,1)",
 ];for(const statement of sql)await db.$executeRawUnsafe(statement);
});
afterAll(async()=>{await db?.$disconnect();if(dir)await rm(dir,{recursive:true,force:true});});
describe('human matching corrections',()=>{
 it('requires an explanation for learning and leaves rejected input unchanged',async()=>{
  await expect(reviewMemberMatch('x1',{status:'dismissed',learn:true,reason:'no'},db)).rejects.toThrow();
  expect(await listMemberFeedback('m1',db)).toEqual([]);
 });
 it('atomically appends a scoped correction, preserves the member profile, and cancels only unsent alerts',async()=>{
  const review=await reviewMemberMatch('x1',{status:'dismissed',learn:true,reason:'They install kitchens but do not transport furniture.'},db);
  expect(review.status).toBe('dismissed');const feedback=await listMemberFeedback('m1',db);expect(feedback).toHaveLength(1);
  expect(feedback[0]).toMatchObject({memberId:'m1',postId:'p1',postText:'Can anyone transport my desk?',reason:'They install kitchens but do not transport furniture.',active:true});
  const members=await db.$queryRawUnsafe<{servicesOffered:string}[]>("SELECT servicesOffered FROM ReferralMember WHERE id='m1'");expect(members[0].servicesOffered).toBe('Design and installation');
  expect(await db.$queryRawUnsafe("SELECT status FROM NotificationDelivery WHERE id='d1'")).toEqual([{status:'cancelled'}]);expect(await db.$queryRawUnsafe("SELECT status FROM NotificationDelivery WHERE id='d2'")).toEqual([{status:'sent'}]);
  expect(await listMemberFeedback('m2',db)).toEqual([]);
 });
 it('deduplicates a retry without overwriting prior feedback',async()=>{
  const before=(await listMemberFeedback('m1',db))[0];await reviewMemberMatch('x1',{status:'dismissed',learn:true,reason:before.reason},db);const after=await listMemberFeedback('m1',db);expect(after).toHaveLength(1);expect(after[0].createdAt).toBe(before.createdAt);
 });
 it('appends subsequent explanations and supports a dismissal without teaching a rule',async()=>{
  await reviewMemberMatch('x1',{status:'dismissed',learn:true,reason:'No furniture delivery service is offered.'},db);expect(await listMemberFeedback('m1',db)).toHaveLength(2);
  await reviewMemberMatch('x2',{status:'dismissed',learn:false,reason:'Already handled by somebody else.'},db);expect(await listMemberFeedback('m1',db)).toHaveLength(2);
 });
 it('uses active feedback as contextual examples, and only hard-blocks the unchanged rejected post for that member',async()=>{
  const feedback=await listMemberFeedback('m1',db);expect(feedbackForPrompt(feedback,'Can someone transport furniture?')[0].reviewerCorrection).toContain('furniture');
  expect(isRejectedExample(feedback,'m1',{id:'p1',latestCapturedText:'Can anyone transport my desk?'})).toBe(true);
  expect(isRejectedExample(feedback,'m2',{id:'p1',latestCapturedText:'Can anyone transport my desk?'})).toBe(false);
  expect(isRejectedExample(feedback,'m1',{id:'p1',latestCapturedText:'Can anyone install a kitchen?'})).toBe(false);
  for(const row of feedback)await setMemberFeedbackActive('m1',row.id,false,db);
  expect(feedbackForPrompt(await listMemberFeedback('m1',db),'desk')).toEqual([]);expect(await listMemberFeedback('m1',db)).toHaveLength(2);
 });
 it('rejects cross-member changes and retains historical corrections',async()=>{
  const feedback=await listMemberFeedback('m1',db);await expect(setMemberFeedbackActive('m2',feedback[0].id,true,db)).rejects.toThrow();expect(feedback).toHaveLength(2);
 });
 it('summarizes without losing evidence or changing unrelated services, and retries failed summaries',async()=>{
  const row=(await listMemberFeedback('m1',db))[0];
  const failed=await summarizeMemberFeedback('m1',row.id,db,async()=>{throw Error('offline');});
  expect(failed.reason).toBe(row.reason);expect(failed.summaryStatus).toBe('failed');
  const summary='Kitchen installation does not include transporting furniture.';
  const ready=await summarizeMemberFeedback('m1',row.id,db,async f=>{expect(f.profileSnapshot.servicesOffered).toBe('Design and installation');return {summary,model:'test-model'};});
  expect(ready.reason).toBe(row.reason);expect(ready.summary).toBe(summary);expect(ready.active).toBe(row.active);
  expect(feedbackForPrompt([{...ready,active:true}],'desk')[0].reviewerCorrection).toBe(summary);
  await expect(summarizeMemberFeedback('m2',row.id,db,async()=>({summary,model:'x'}))).rejects.toThrow();
  const again=await summarizeMemberFeedback('m1',row.id,db,async()=>{throw Error('must not call twice');});expect(again.summary).toBe(summary);
 });
 it('rolls back the correction and dismissal together if alert cancellation fails',async()=>{
  const before=await db.$queryRawUnsafe("SELECT status,note FROM AiMemberMatch WHERE id='x2'");await db.$executeRawUnsafe('DROP TABLE NotificationDelivery');const count=(await listMemberFeedback('m1',db)).length;
  await expect(reviewMemberMatch('x2',{status:'dismissed',learn:true,reason:'They do not offer this particular service.'},db)).rejects.toThrow();expect(await listMemberFeedback('m1',db)).toHaveLength(count);expect(await db.$queryRawUnsafe("SELECT status,note FROM AiMemberMatch WHERE id='x2'")).toEqual(before);
 });
});
