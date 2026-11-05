import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { visitorSeed } from './visitor-seed.js';
import { businessIdentity, contentHash, exclusionMatch, geography, matchedTerms, visitorStatuses } from './visitor-matching.js';
export async function initializeVisitors(db: PrismaClient = prisma) {
    for (const category of visitorSeed.categories)
        await db.visitorCategory.upsert({ where: { id: category.id }, create: category, update: {} });
    for (const exclusion of visitorSeed.exclusions)
        await db.visitorExclusion.upsert({ where: { id: exclusion.id }, create: exclusion, update: {} });
}
export async function visitorDirectory(days = 30, db: PrismaClient = prisma) {
    if (!Number.isFinite(days) || days < 1 || days > 365)
        throw Error('Invalid activity window');
    const [categories, exclusions, businesses] = await Promise.all([db.visitorCategory.findMany(), db.visitorExclusion.findMany(), db.visitorBusiness.findMany({ include: { evidence: true } })]);
    const posts = await db.post.findMany({ where: { id: { in: [...new Set(businesses.flatMap(b => b.evidence.map(e => e.postId)))] } }, include: { group: { select: { friendlyName: true } } } });
    const byId = new Map(posts.map(p => [p.id, p]));
    const cutoff = Date.now() - days * 86400000;
    return { categories, exclusions, businesses: businesses.map(b => {
            const evidence = b.evidence.flatMap(e => { const post = byId.get(e.postId); return post ? [{ ...e, post }] : []; });
            const recent = evidence.filter(e => (e.post.originalPostedAt ?? e.post.firstDiscoveredAt).getTime() >= cutoff);
            const appearances = new Set(recent.map(e => e.postId)).size;
            const exclusionsMatched = exclusionMatch([b.name, b.website, b.phone, ...evidence.map(e => e.post.latestCapturedText ?? e.post.firstCapturedText ?? '')].join(' '), exclusions.filter(e => e.active));
            const dates = evidence.map(e => (e.post.originalPostedAt ?? e.post.firstDiscoveredAt).getTime());
            return { ...b, evidence, appearances, distinctPosts: new Set(recent.map(e => e.contentHash)).size, firstSeen: dates.length ? new Date(Math.min(...dates)).toISOString() : null, lastSeen: dates.length ? new Date(Math.max(...dates)).toISOString() : null, exclusionsMatched };
        }).sort((a, b) => b.distinctPosts - a.distinctPosts || b.appearances - a.appearances), days };
}
let scanning = false;
export async function trialVisitors(db: PrismaClient = prisma) {
    if (scanning)
        throw Error('A visitor trial is already running');
    scanning = true;
    let inspected = 0, matched = 0, added = 0;
    try {
        const [categories, exclusions] = await Promise.all([db.visitorCategory.findMany({ where: { active: true } }), db.visitorExclusion.findMany({ where: { active: true } })]);
        let cursor: string | undefined;
        for (;;) {
            const posts = await db.post.findMany({ take: 200, orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, latestCapturedText: true, firstCapturedText: true } });
            if (!posts.length)
                break;
            for (const post of posts) {
                inspected++;
                const text = post.latestCapturedText ?? post.firstCapturedText ?? '';
                if (!text.trim())
                    continue;
                // A trial candidate needs published contact information or an explicit business label.
                const identity = businessIdentity(text, post.id);
                if (identity.identityKey.startsWith('post:') && !/\b(?:company|business(?: name)?)\s*:|\b(?:our services|we offer|free quote|fully insured|contact us|book now|our team)\b/i.test(text))
                    continue;
                const matches = categories.map(c => ({ category: c, terms: matchedTerms(text, c.keywords as string[]) })).filter(m => m.terms.length);
                if (!matches.length)
                    continue;
                matched++;
                const blocked = exclusionMatch(text, exclusions);
                await db.$transaction(async (tx) => {
                    let business: Awaited<ReturnType<typeof tx.visitorBusiness.upsert>> | undefined;
                    const getBusiness = async () => {
                        if (business)
                            return business;
                        const alias = await tx.visitorIdentity.findUnique({ where: { key: identity.identityKey } });
                        if (alias)
                            return business = await tx.visitorBusiness.findUniqueOrThrow({ where: { id: alias.businessId } });
                        business = await tx.visitorBusiness.upsert({ where: { identityKey: identity.identityKey }, create: { identityKey: identity.identityKey, name: identity.name, website: identity.website, phone: identity.phone, status: blocked[0]?.status ?? 'not contacted', reviewNote: 'Trial candidate: verify business identity, category fit, owner and service area before outreach.' }, update: {} });
                        await tx.visitorIdentity.upsert({ where: { key: identity.identityKey }, create: { key: identity.identityKey, businessId: business.id }, update: {} });
                        return business;
                    };
                    for (const { category, terms } of matches) {
                        const existing = await tx.visitorEvidence.findUnique({ where: { postId_categoryId: { postId: post.id, categoryId: category.id } } });
                        if (existing) {
                            if(!identity.needsReview){const current=await tx.visitorBusiness.findUnique({where:{id:existing.businessId}});if(current&&(current.name==='Unidentified business — review source'||current.name===identity.website?.replace('https://','')))await tx.visitorBusiness.update({where:{id:current.id},data:{name:identity.name}});}
                            await tx.visitorEvidence.update({ where: { id: existing.id }, data: { contentHash: contentHash(text), matchedTerms: terms, geographyEvidence: geography(text) } });
                            continue;
                        }
                        await tx.visitorEvidence.create({ data: { businessId: (await getBusiness()).id, postId: post.id, categoryId: category.id, contentHash: contentHash(text), matchedTerms: terms, geographyEvidence: geography(text) } });
                        added++;
                    }
                });
            }
            cursor = posts.at(-1)!.id;
        }
        return { inspected, matched, added, message: 'Trial complete. Candidates require review; no Facebook requests, AI calls or outreach were made.' };
    }
    finally {
        scanning = false;
    }
}
export async function updateVisitor(id: string, input: unknown) { const data = z.object({ name: z.string().trim().min(1).max(200).optional(), status: z.enum(visitorStatuses).optional(), reviewNote: z.string().max(4000).optional() }).strict().parse(input); return prisma.visitorBusiness.update({ where: { id }, data }); }
export async function saveCategory(id: string, input: unknown) { const data = z.object({ name: z.string().trim().min(1).max(200), includeRules: z.string().max(6000), excludeRules: z.string().max(6000), keywords: z.array(z.string().trim().min(2).max(100)).min(1).max(100), area: z.string().max(1000), priority: z.string().max(50), reviewFlag: z.string().max(1000).nullable(), active: z.boolean() }).strict().parse(input); return prisma.visitorCategory.upsert({ where: { id }, create: { id, ...data }, update: data }); }
export async function updateExclusion(id: string, input: unknown) { const data = z.object({ active: z.boolean() }).strict().parse(input); return prisma.visitorExclusion.update({ where: { id }, data }); }
export async function mergeVisitors(sourceId: string, targetId: string, db:PrismaClient=prisma) {
    if (sourceId === targetId)
        throw Error('Invalid merge target');
    return db.$transaction(async (tx) => {
        const source = await tx.visitorBusiness.findUniqueOrThrow({ where: { id: sourceId } });
        const target = await tx.visitorBusiness.findUniqueOrThrow({ where: { id: targetId } });
        if (source.status !== target.status)
            throw Error('Set both businesses to the same outreach status before merging, so no status is lost.');
        await tx.visitorEvidence.updateMany({ where: { businessId: sourceId }, data: { businessId: targetId } });
        await tx.visitorBusiness.update({ where: { id: targetId }, data: { reviewNote: [target.reviewNote, `Manually merged ${source.name}: ${source.website ?? ''} ${source.phone ?? ''}`, source.reviewNote].filter(Boolean).join('\n') } });
        await tx.visitorIdentity.updateMany({ where: { businessId: sourceId }, data: { businessId: targetId } });
        await tx.visitorIdentity.upsert({ where: { key: source.identityKey }, create: { key: source.identityKey, businessId: targetId }, update: { businessId: targetId } });
        await tx.visitorBusiness.delete({ where: { id: sourceId } });
        return { merged: true };
    });
}
