import { prisma } from './prisma.js';

const REQUIRED_POST_AI_ASSESSMENT_COLUMNS = [
  'provider',
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'estimatedCostUsd',
  'durationMs',
  'cachedInputTokens',
  'requestCount',
  'pricingSnapshot',
] as const;

export class SchemaOutOfDateError extends Error {
  constructor(missingColumns: string[]) {
    super(
      `Database schema is out of date. Missing PostAiAssessment column(s): ${missingColumns.join(', ')}. ` +
      'Run `npm run db:migrate` from the project root, then restart the API.',
    );
    this.name = 'SchemaOutOfDateError';
  }
}

export async function assertAiSchemaReady() {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("PostAiAssessment")');
  const existing = new Set(rows.map((row) => row.name));
  const missing = REQUIRED_POST_AI_ASSESSMENT_COLUMNS.filter((column) => !existing.has(column));
  if (missing.length > 0) throw new SchemaOutOfDateError(missing);
  return { ok: true as const, columns: [...existing] };
}
