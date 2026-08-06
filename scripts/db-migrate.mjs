#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.FB_MONITOR_DATA_DIR ?? path.join(os.homedir(), 'Library', 'Application Support', 'FacebookGroupMonitor');
const databasePath = path.join(dataDir, 'database', 'app.sqlite');
const backupsDir = path.join(dataDir, 'backups');

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
fs.mkdirSync(backupsDir, { recursive: true });

if (fs.existsSync(databasePath)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupsDir, `app.sqlite.pre-migrate-${stamp}.bak`);
  fs.copyFileSync(databasePath, backupPath);
  console.log(`Backed up database to ${backupPath}`);
}

const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? `file:${databasePath}`,
};

const deploy = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  cwd: root,
  env,
  stdio: 'inherit',
});
if (deploy.status !== 0) process.exit(deploy.status ?? 1);

const generate = spawnSync('npx', ['prisma', 'generate'], {
  cwd: root,
  env,
  stdio: 'inherit',
});
process.exit(generate.status ?? 1);
