import { prisma } from '../db/prisma.js';

interface ReferralMemberInput {
  name: string;
  businessName?: string;
  facebookName?: string;
  facebookProfileUrl?: string;
  category: string;
  keywords: string;
  servicesOffered?: string;
  idealReferral?: string;
  negativeKeywords?: string;
  notes?: string;
  active?: boolean;
}

export const referralCsvColumns = [
  'name',
  'businessName',
  'category',
  'facebookName',
  'facebookProfileUrl',
  'keywords',
  'servicesOffered',
  'idealReferral',
  'negativeKeywords',
  'notes',
  'active',
];

const allowedAiMatchStatuses = new Set(['new', 'copied', 'introduced', 'dismissed', 'not_relevant']);

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
    facebookName: input.facebookName?.trim() || null,
    facebookProfileUrl: input.facebookProfileUrl?.trim() || null,
    category: input.category.trim(),
    keywords: input.keywords.trim(),
    servicesOffered: input.servicesOffered?.trim() || null,
    idealReferral: input.idealReferral?.trim() || null,
    negativeKeywords: input.negativeKeywords?.trim() || null,
    notes: input.notes?.trim() || null,
    active: input.active ?? true,
  };
}

export async function getReferralDirectory() {
  const [members, suggested, accepted, dismissed, aiMatchGroups] = await Promise.all([
    prisma.referralMember.findMany({ orderBy: [{ active: 'desc' }, { category: 'asc' }, { name: 'asc' }] }),
    prisma.referralMatch.count({ where: { status: 'suggested' } }),
    prisma.referralMatch.count({ where: { status: 'accepted' } }),
    prisma.referralMatch.count({ where: { status: 'dismissed' } }),
    prisma.aiMemberMatch.groupBy({
      by: ['referralMemberId', 'status'],
      _count: { _all: true },
    }),
  ]);

  const aiCountsByMember = new Map<string, Record<string, number>>();
  for (const group of aiMatchGroups) {
    const counts = aiCountsByMember.get(group.referralMemberId) ?? {};
    counts[group.status] = group._count._all;
    aiCountsByMember.set(group.referralMemberId, counts);
  }

  return {
    members: members.map((member) => {
      const aiCounts = aiCountsByMember.get(member.id) ?? {};
      return {
        ...member,
        aiMatchCounts: {
          total: Object.values(aiCounts).reduce((sum, value) => sum + value, 0),
          new: aiCounts.new ?? 0,
          copied: aiCounts.copied ?? 0,
          introduced: aiCounts.introduced ?? 0,
          dismissed: aiCounts.dismissed ?? 0,
          not_relevant: aiCounts.not_relevant ?? 0,
        },
      };
    }),
    matchCounts: { suggested, accepted, dismissed },
  };
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
  if (input.facebookName !== undefined) data.facebookName = input.facebookName?.trim() || null;
  if (input.facebookProfileUrl !== undefined) data.facebookProfileUrl = input.facebookProfileUrl?.trim() || null;
  if (input.category !== undefined) {
    if (!input.category.trim()) throw new Error('Referral category is required.');
    data.category = input.category.trim();
  }
  if (input.keywords !== undefined) {
    if (!input.keywords.trim()) throw new Error('At least one keyword is required.');
    data.keywords = input.keywords.trim();
  }
  if (input.servicesOffered !== undefined) data.servicesOffered = input.servicesOffered?.trim() || null;
  if (input.idealReferral !== undefined) data.idealReferral = input.idealReferral?.trim() || null;
  if (input.negativeKeywords !== undefined) data.negativeKeywords = input.negativeKeywords?.trim() || null;
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

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function getReferralCsvTemplate() {
  const sample = [
    'Jane Smith',
    'Smith Plumbing',
    'Plumbing',
    '@janesmith',
    'https://www.facebook.com/jane.smith',
    'plumber, plumbing, boiler, leak',
    'Domestic plumbing, repairs, emergency leaks',
    'Homeowners or businesses needing plumbing repairs',
    'accounting, website design',
    'Referral member notes',
    'true',
  ];
  return `${referralCsvColumns.join(',')}\n${sample.map(csvEscape).join(',')}\n`;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function boolFromCsv(value: string) {
  if (!value.trim()) return true;
  return ['true', 'yes', '1', 'active'].includes(value.trim().toLowerCase());
}

function normaliseDuplicateKey(input: Pick<ReferralMemberInput, 'name' | 'businessName' | 'facebookName'>) {
  const facebookName = input.facebookName?.trim().toLowerCase();
  if (facebookName) return `facebook:${facebookName}`;
  return `namebiz:${input.name.trim().toLowerCase()}::${(input.businessName ?? '').trim().toLowerCase()}`;
}

function memberToDuplicateKey(member: { name: string; businessName?: string | null; facebookName?: string | null }) {
  return normaliseDuplicateKey({ name: member.name, businessName: member.businessName ?? undefined, facebookName: member.facebookName ?? undefined });
}

export async function previewReferralCsvImport(csvText: string) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error('CSV must include a header row and at least one member row.');
  const headers = rows[0].map((header) => header.trim());
  const missing = referralCsvColumns.filter((column) => !headers.includes(column));
  if (missing.length > 0) throw new Error(`CSV is missing required column(s): ${missing.join(', ')}`);

  const existingMembers = await prisma.referralMember.findMany();
  const existingByKey = new Map(existingMembers.map((member) => [memberToDuplicateKey(member), member]));
  const imports = rows.slice(1).map((row, index) => {
    const record = Object.fromEntries(headers.map((header, columnIndex) => [header, row[columnIndex] ?? '']));
    const input: ReferralMemberInput = {
      name: String(record.name ?? '').trim(),
      businessName: String(record.businessName ?? '').trim(),
      facebookName: String(record.facebookName ?? '').trim(),
      facebookProfileUrl: String(record.facebookProfileUrl ?? '').trim(),
      category: String(record.category ?? '').trim(),
      keywords: String(record.keywords ?? '').trim(),
      servicesOffered: String(record.servicesOffered ?? '').trim(),
      idealReferral: String(record.idealReferral ?? '').trim(),
      negativeKeywords: String(record.negativeKeywords ?? '').trim(),
      notes: String(record.notes ?? '').trim(),
      active: boolFromCsv(String(record.active ?? '')),
    };
    const duplicate = input.name ? existingByKey.get(normaliseDuplicateKey(input)) : undefined;
    return {
      rowNumber: index + 2,
      input,
      valid: Boolean(input.name && input.category && input.keywords),
      duplicateMemberId: duplicate?.id,
      duplicateName: duplicate?.name,
    };
  });

  return {
    rows: imports,
    total: imports.length,
    valid: imports.filter((item) => item.valid).length,
    duplicates: imports.filter((item) => item.duplicateMemberId).length,
    invalid: imports.filter((item) => !item.valid).length,
  };
}

export async function applyReferralCsvImport(csvText: string, mode: 'skip' | 'overwrite' = 'skip') {
  const preview = await previewReferralCsvImport(csvText);
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of preview.rows) {
    if (!row.valid) {
      skipped += 1;
      continue;
    }
    if (row.duplicateMemberId) {
      if (mode === 'overwrite') {
        await updateReferralMember(row.duplicateMemberId, row.input);
        updated += 1;
      } else {
        skipped += 1;
      }
      continue;
    }
    await createReferralMember(row.input);
    created += 1;
  }
  return { created, updated, skipped, preview };
}

export async function listMemberAiMatches(
  memberId: string,
  options: { search?: string; minScore?: number; status?: string; page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, Number(options.page ?? 1));
  const pageSize = Math.max(1, Math.min(100, Number(options.pageSize ?? 25)));
  const where: Record<string, unknown> = { referralMemberId: memberId };
  if (typeof options.minScore === 'number' && Number.isFinite(options.minScore) && options.minScore > 0) {
    where.score = { gte: Math.min(1, Math.max(0, options.minScore)) };
  }
  if (options.status && options.status !== 'all') where.status = options.status;
  if (options.search?.trim()) {
    const term = options.search.trim();
    where.assessment = { post: { OR: [{ latestCapturedText: { contains: term } }, { canonicalPostUrl: { contains: term } }, { authorName: { contains: term } }] } };
  }
  const [member, items, total] = await Promise.all([
    prisma.referralMember.findUnique({ where: { id: memberId } }),
    prisma.aiMemberMatch.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        assessmentId: true,
        referralMemberId: true,
        score: true,
        scorePercent: true,
        reason: true,
        suggestedIntro: true,
        status: true,
        copiedAt: true,
        introducedAt: true,
        dismissedAt: true,
        note: true,
        createdAt: true,
        assessment: {
          select: {
            id: true,
            intent: true,
            summary: true,
            confidence: true,
            post: {
              select: {
                id: true,
                canonicalPostUrl: true,
                latestCapturedText: true,
                authorName: true,
                firstDiscoveredAt: true,
                group: { select: { friendlyName: true } },
              },
            },
          },
        },
      },
    }),
    prisma.aiMemberMatch.count({ where }),
  ]);
  if (!member) throw new Error('Referral member not found.');
  return { member, items, total };
}

export async function updateAiMemberMatchStatus(id: string, input: { status: string; note?: string }) {
  if (!allowedAiMatchStatuses.has(input.status)) throw new Error(`Invalid AI match status: ${input.status}`);
  const now = new Date();
  return prisma.aiMemberMatch.update({
    where: { id },
    data: {
      status: input.status,
      note: input.note,
      copiedAt: input.status === 'copied' ? now : undefined,
      introducedAt: input.status === 'introduced' ? now : undefined,
      dismissedAt: ['dismissed', 'not_relevant'].includes(input.status) ? now : undefined,
    },
  });
}
