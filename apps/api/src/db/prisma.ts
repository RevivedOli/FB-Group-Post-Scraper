import '../config/env.js';
import { PrismaClient } from '@prisma/client';
import { sqliteRuntimeUrl } from './sqlite-runtime.js';
export const prisma = new PrismaClient({
  datasourceUrl: sqliteRuntimeUrl(process.env.DATABASE_URL!),
  transactionOptions:{maxWait:10000,timeout:10000},
});
export async function initializeDatabase(){
  // WAL keeps UI readers from blocking collector/assessment writes. Persistent per file.
  await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL');
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout=15000');
}
