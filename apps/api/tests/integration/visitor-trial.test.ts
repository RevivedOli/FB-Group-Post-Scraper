import { afterAll, beforeAll, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initializeVisitors, trialVisitors, visitorDirectory, mergeVisitors } from '../../src/services/visitors.service.js';
let dir: string, db: PrismaClient;
beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'visitor-trial-'));
    db = new PrismaClient({ datasourceUrl: `file:${path.join(dir, 'test.sqlite')}` });
    const root = path.resolve('../../prisma/migrations');
    for (const folder of (await readdir(root)).sort()) {
        if (!/^\d/.test(folder))
            continue;
        const sql = await readFile(path.join(root, folder, 'migration.sql'), 'utf8');
        for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean))
            await db.$executeRawUnsafe(statement);
    }
    await initializeVisitors(db);
    await db.group.create({ data: { id: 'g', facebookGroupUrl: 'https://facebook.com/groups/1', canonicalGroupUrl: 'https://facebook.com/groups/1', friendlyName: 'Ascot', displayOrder: 1 } });
    const fixtures = [['p1', 'Company: Sparkle Ltd\nCommercial cleaning in Ascot https://sparkle.example 07700900123'], ['p2', 'Company: Sparkle Ltd\nCommercial cleaning in Ascot https://sparkle.example 07700900123'], ['p3', 'Office cleaning from our team in Windsor https://sparkle.example'], ['p4', 'Bergamot HR Consulting offers HR consultancy https://bergamot.example'], ['p5', 'Looking for a carpenter please'], ['p6', 'Our services include carpentry. Fully insured. Free quote.']];
    for (const [id, text] of fixtures)
        await db.post.create({ data: { id, groupId: 'g', canonicalPostUrl: `https://facebook.com/groups/1/posts/${id}`, latestCapturedText: text, authorName: 'Public poster', originalPostedAt: new Date() } });
}, 30000);
afterAll(async () => { await db?.$disconnect(); if (dir)
    await rm(dir, { recursive: true, force: true }); });
it('persists candidates, groups published domains, deduplicates appearances and preserves draft exclusions', async () => {
    const first = await trialVisitors(db);
    expect(first.added).toBe(5);
    expect((await trialVisitors(db)).added).toBe(0);
    const result = await visitorDirectory(30, db);
    const sparkle = result.businesses.find(b => b.website === 'https://sparkle.example')!;
    expect(sparkle.appearances).toBe(3);
    expect(sparkle.distinctPosts).toBe(2);
    expect(sparkle.evidence).toHaveLength(3);
    const hr = result.businesses.find(b => b.website === 'https://bergamot.example')!;
    expect(hr.status).toBe('drafted');
    expect(hr.exclusionsMatched.map(e => e.id)).toContain('outreach-V1');
    expect(result.businesses.some(b => b.identityKey === 'post:p6')).toBe(true);
    expect(result.businesses.some(b => b.identityKey === 'post:p5')).toBe(false);
    await db.visitorBusiness.update({ where: { id: sparkle.id }, data: { status: 'invited', name: 'Confirmed Sparkle' } });
    await trialVisitors(db);
    expect((await db.visitorBusiness.findUnique({ where: { id: sparkle.id } }))?.status).toBe('invited');
    await db.visitorCategory.update({ where: { id: 'visitor-category-1' }, data: { active: false } });
    await initializeVisitors(db);
    expect((await db.visitorCategory.findUnique({ where: { id: 'visitor-category-1' } }))?.active).toBe(false);
}, 30000);

it('retains aliases after a reviewed manual merge so future posts use the same business',async()=>{
 const target=await db.visitorBusiness.findUniqueOrThrow({where:{identityKey:'domain:sparkle.example'}});
 await db.post.create({data:{id:'p7',groupId:'g',canonicalPostUrl:'https://facebook.com/groups/1/posts/p7',latestCapturedText:'Commercial cleaning https://second-domain.example',originalPostedAt:new Date()}});
 await db.visitorCategory.update({where:{id:'visitor-category-1'},data:{active:true}});
 await trialVisitors(db);
 const source=await db.visitorBusiness.findUniqueOrThrow({where:{identityKey:'domain:second-domain.example'}});
 await expect(mergeVisitors(source.id,target.id,db)).rejects.toThrow('same outreach status');
 await db.visitorBusiness.update({where:{id:source.id},data:{status:target.status}});
 await mergeVisitors(source.id,target.id,db);
 await db.post.create({data:{id:'p8',groupId:'g',canonicalPostUrl:'https://facebook.com/groups/1/posts/p8',latestCapturedText:'Office cleaning new offer https://second-domain.example',originalPostedAt:new Date()}});
 await trialVisitors(db);
 expect(await db.visitorBusiness.findUnique({where:{id:source.id}})).toBeNull();
 expect((await db.visitorEvidence.findFirstOrThrow({where:{postId:'p8'}})).businessId).toBe(target.id);
});
