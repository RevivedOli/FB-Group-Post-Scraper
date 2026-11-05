import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {latestCompletedPostFilter} from '../../src/services/post-ai-filter.js';
let dir:string,db:PrismaClient;
beforeAll(async()=>{
 dir=await mkdtemp(path.join(os.tmpdir(),'post-filter-'));db=new PrismaClient({datasourceUrl:`file:${path.join(dir,'test.sqlite')}`});
 await db.$executeRawUnsafe('CREATE TABLE PostAiAssessment(id TEXT,postId TEXT,status TEXT,intent TEXT,isReferralOpportunity INTEGER,createdAt INTEGER)');
 await db.$executeRawUnsafe('CREATE TABLE AiMemberMatch(assessmentId TEXT,referralMemberId TEXT)');
 await db.$executeRawUnsafe(`INSERT INTO PostAiAssessment VALUES ('a1','p1','completed','looking_for_help',0,1),('a2','p1','completed','advertising',0,2),('a3','p2','completed','looking_for_help',0,2),('a4','p3','completed','looking_for_help',1,2),('a5','p4','pending',NULL,NULL,3),('a6','p5','skipped',NULL,NULL,3)`);
 await db.$executeRawUnsafe("INSERT INTO AiMemberMatch VALUES ('a4','m1')");
});
afterAll(async()=>{await db?.$disconnect();if(dir)await rm(dir,{recursive:true,force:true});});
describe('latest completed AI post filters',()=>{
 it('includes help requests without a member match, excluding superseded help, pending and skipped',async()=>{const rows=await db.$queryRaw<{postId:string}[]>(latestCompletedPostFilter({aiIntent:'looking_for_help'}));expect(rows.map(row=>row.postId).sort()).toEqual(['p2','p3']);});
 it('applies referrals-only and member constraints to that same decision',async()=>{expect(await db.$queryRaw(latestCompletedPostFilter({aiIntent:'looking_for_help',aiReferralOnly:true}))).toEqual([{postId:'p3'}]);expect(await db.$queryRaw(latestCompletedPostFilter({aiMemberId:'m1'}))).toEqual([{postId:'p3'}]);});
 it('binds arbitrary member inputs safely instead of interpreting SQL',async()=>{expect(await db.$queryRaw(latestCompletedPostFilter({aiMemberId:"m1' OR 1=1 --"}))).toEqual([]);});
});
