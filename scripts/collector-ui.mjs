#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiPort = process.env.PORT ?? '3001';
const webPort = process.env.COLLECTOR_UI_PORT ?? '5182';
if (![apiPort,webPort].every(value => /^\d+$/.test(value) && Number(value) > 0 && Number(value) < 65536)) throw new Error('Invalid local port');
const env = { ...process.env, PORT:apiPort, VITE_API_URL:`http://127.0.0.1:${apiPort}/api` };
const build = spawnSync('npm',['run','build'],{cwd:root,env,stdio:'inherit'});
if(build.status !== 0)process.exit(build.status ?? 1);
const children = [
  spawn(process.execPath,['scripts/collector-api.mjs'],{cwd:root,env,stdio:'inherit'}),
  spawn('npm',['run','dev','--workspace','@local-group-monitor/web','--','--port',webPort,'--strictPort'],{cwd:root,env,stdio:'inherit'}),
];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); process.exitCode = code; }
for (const child of children) { child.on('error', () => stop(1)); child.on('exit', code => stop(code ?? 0)); }
process.on('SIGINT',()=>stop()); process.on('SIGTERM',()=>stop());
console.log(`Collector UI: http://127.0.0.1:${webPort}/ — scheduled collector and Telegram delivery run in the supervised backend.`);
