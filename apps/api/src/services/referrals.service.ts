import { prisma } from '../db/prisma.js';

interface ReferralMemberInput {
  name: string;
  businessName?: string;
  category: string;
  keywords: string;
  notes?: string;
  active?: boolean;
}

function splitKeywords(value: string) {
  return value
    .split(',')
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);
}

function scorePostForKeywords(text: string, keywords: string[]) {
  const haystack = text.toLowerCase();
  const matchedKeywords = keywords.filter((keyword) => haystack.includes(keyword));
  if (matchedKeywords.length === 0) return { score: 0, matchedKeywords };
  return {
    score: Math.min(1, matchedKeywords.length / Math.max(2, keywords.length)),
    matchedKeywords,
  };
}

function cleanMemberInput(input: ReferralMemberInput) {
  if (!input.name?.trim()) throw new Error('Referral member name is required.');
  if (!input.category?.trim()) throw new Error('Referral category is required.');
  if (!input.keywords?.trim()) throw new Error('At least one keyword is required.');
  return {
    name: input.name.trim(),
    businessName: input.businessName?.trim() || null,
    category: input.category.trim(),
    keywords: input.keywords.trim(),
    notes: input.notes?.trim() || null,
    active: input.active ?? true,
  };
}

export async function getReferralDirectory() {
  const [members, suggested, accepted, dismissed] = await Promise.all([
    prisma.referralMember.findMany({ orderBy: [{ active: 'desc' }, { category: 'asc' }, { name: 'asc' }] }),
    prisma.referralMatch.count({ where: { status: 'suggested' } }),
    prisma.referralMatch.count({ where: { status: 'accepted' } }),
    prisma.referralMatch.count({ where: { status: 'dismissed' } }),
  ]);

  return { members, matchCounts: { suggested, accepted, dismissed } };
}

export async function createReferralMember(input: ReferralMemberInput) {
  return prisma.referralMember.create({ data: cleanMemberInput(input) });
}

export async function updateReferralMember(id: string, input: Partial<ReferralMemberInput>) {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new Error('Referral member name is required.');
    data.name = input.name.trim();
  }
  if (input.businessName !== undefined) data.businessName = input.businessName?.trim() || null;
  if (input.category !== undefined) {
    if (!input.category.trim()) throw new Error('Referral category is required.');
    data.category = input.category.trim();
  }
  if (input.keywords !== undefined) {
    if (!input.keywords.trim()) throw new Error('At least one keyword is required.');
    data.keywords = input.keywords.trim();
  }
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
  if (input.active !== undefined) data.active = input.active;
  return prisma.referralMember.update({ where: { id }, data });
}

export async function deleteReferralMember(id: string) {
  return prisma.referralMember.delete({ where: { id } });
}

export async function generateReferralMatches() {
  const [members, posts] = await Promise.all([
    prisma.referralMember.findMany({ where: { active: true } }),
    prisma.post.findMany({
      where: {
        reviewStatus: { in: ['new', 'requires_review', 'useful'] },
        monitoringStatus: 'active',
      },
      select: { id: true, latestCapturedText: true, ocrText: true },
    }),
  ]);

  let created = 0;
  let updated = 0;

  for (const post of posts) {
    const text = [post.latestCapturedText, post.ocrText].filter(Boolean).join(' ');
    if (!text.trim()) continue;

    for (const member of members) {
      const result = scorePostForKeywords(text, splitKeywords(member.keywords));
      if (result.score <= 0) continue;

      const existing = await prisma.referralMatch.findUnique({
        where: { postId_referralMemberId: { postId: post.id, referralMemberId: member.id } },
      });

      if (existing) {
        await prisma.referralMatch.update({
          where: { id: existing.id },
          data: { score: result.score, matchedKeywords: result.matchedKeywords },
        });
        updated += 1;
      } else {
        await prisma.referralMatch.create({
          data: {
            postId: post.id,
            referralMemberId: member.id,
            score: result.score,
            matchedKeywords: result.matchedKeywords,
          },
        });
        created += 1;
      }
    }
  }

  return { created, updated };
}

export async function listReferralMatches(status = 'suggested', page = 1, pageSize = 25) {
  const where = status === 'all' ? {} : { status };
  const skip = Math.max(0, page - 1) * pageSize;
  const [items, total] = await Promise.all([
    prisma.referralMatch.findMany({
      where,
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: Math.max(1, Math.min(100, pageSize)),
      include: {
        referralMember: true,
        post: {
          select: {
            id: true,
            latestCapturedText: true,
            canonicalPostUrl: true,
            authorName: true,
            group: { select: { friendlyName: true } },
          },
        },
      },
    }),
    prisma.referralMatch.count({ where }),
  ]);

  return { items, total };
}

export async function updateReferralMatchStatus(id: string, status: string) {
  if (!['suggested', 'accepted', 'dismissed'].includes(status)) throw new Error(`Invalid referral match status: ${status}`);
  return prisma.referralMatch.update({ where: { id }, data: { status } });
}
