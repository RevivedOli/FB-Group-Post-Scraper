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
  // The SQLite backup API includes committed WAL content; copying only app.sqlite does not.
  const backup = spawnSync('python3', ['-c',
    'import sqlite3,sys; source=sqlite3.connect(sys.argv[1],timeout=15); target=sqlite3.connect(sys.argv[2]); source.backup(target); target.close(); source.close()',
    databasePath, backupPath], { stdio:'inherit', timeout:30000 });
  if (backup.status !== 0 || backup.error) {
    console.error('Database backup failed; migration cancelled.');
    process.exit(1);
  }
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
