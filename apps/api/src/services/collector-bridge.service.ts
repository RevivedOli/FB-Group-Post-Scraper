import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { prisma } from '../db/prisma.js';
import { queuePostAfterScrape } from './ai-assessment.service.js';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const source = path.resolve(process.env.FACEBOOK_COLLECTOR_DATA_DIR ?? path.join(root, 'facebook_collector/data'), 'collector.db');
// v2 replays existing saved posts once through structured-source eligibility.
// Post and assessment identity checks make this restart-safe.
const cursorKey = `collector_bridge_cursor:v2:${source}`;
type SourcePost = { group_id:string; post_id:string; text:string; published_at:string|null; first_observed_at:string; last_observed_at:string; revision:number };
type SourceGroup = { id:string; url:string; name:string|null; enabled:number; next_due_at:string|null; last_attempted_at:string|null; last_successful_at:string|null; access_status:string };
type Snapshot = { connected:boolean; posts:SourcePost[]; groups:SourceGroup[]; total_posts:number };
let pending: Promise<BridgeStatus> | undefined;
export type BridgeStatus = { connected:boolean; source:string; imported:number; sourcePosts:number; groups:SourceGroup[]; lastSyncAt:string|null; error:string|null };
let status: BridgeStatus = { connected:false, source, imported:0, sourcePosts:0, groups:[], lastSyncAt:null, error:null };
export function collectorBridgeStatus() { return { ...status, syncing:Boolean(pending) }; }

async function readSnapshot(cursor: unknown) {
  const { stdout } = await exec(process.env.COLLECTOR_PYTHON ?? 'python3', [path.join(root, 'facebook_collector/scripts/ui_snapshot.py'), source, JSON.stringify(cursor)], { timeout:15000, maxBuffer:8 * 1024 * 1024 });
  return JSON.parse(stdout) as Snapshot;
}

async function run(): Promise<BridgeStatus> {
  let imported = 0;
  try {
    // Bound each pass; concurrent requests share one promise, not another importer.
    for (let batch = 0; batch < 5; batch++) {
      const saved = await prisma.setting.findUnique({ where:{ key:cursorKey } });
      const data = await readSnapshot(saved?.value ?? null);
      status = { ...status, connected:data.connected, sourcePosts:data.total_posts, groups:data.groups, error:null };
      if (!data.connected) break;
      const groupMap = new Map<string,string>();
      for (const group of data.groups) {
        if (!/^\d+$/.test(group.id)) throw new Error('Unsupported collector group identity');
        const canonicalGroupUrl = `https://www.facebook.com/groups/${group.id}`;
        const byIdentity = await prisma.group.findFirst({ where:{ facebookGroupId:group.id } });
        const target = byIdentity ?? await prisma.group.upsert({ where:{ canonicalGroupUrl }, update:{ facebookGroupId:group.id }, create:{
          id:`collector-group-${group.id}`, facebookGroupId:group.id, canonicalGroupUrl, facebookGroupUrl:canonicalGroupUrl,
          friendlyName:group.name || group.id, displayOrder:await prisma.group.count(),
          // Existing browser scraper should not also scan imported sources automatically.
          enabled:false, notes:'Posts supplied by the Python collector. Collection settings remain in the CLI.',
        } });
        groupMap.set(group.id,target.id);
      }
      for (const post of data.posts) {
        if (!/^\d+$/.test(post.post_id) || !groupMap.has(post.group_id)) throw new Error('Invalid collector post identity');
        const groupId = groupMap.get(post.group_id)!;
        const canonicalPostUrl = `https://www.facebook.com/groups/${post.group_id}/posts/${post.post_id}`;
        const existing = await prisma.post.findFirst({ where:{ OR:[{ canonicalPostUrl }, { groupId, facebookPostId:post.post_id }] } });
        if (existing && existing.groupId !== groupId) throw new Error('Collector post identity collision');
        const fields = { latestCapturedText:post.text, lastObservedAt:new Date(post.last_observed_at), originalPostedAt:post.published_at ? new Date(post.published_at) : undefined };
        const target = existing ? await prisma.post.update({ where:{id:existing.id}, data:fields }) : await prisma.post.create({ data:{
          id:`collector-post-${post.group_id}-${post.post_id}`, groupId, facebookPostId:post.post_id, canonicalPostUrl,
          firstCapturedText:post.text, firstDiscoveredAt:new Date(post.first_observed_at), ...fields,
          extractionStrategy:'facebook_gql', extractionConfidence:0, fieldWarnings:['media_not_collected','confidence_not_scored'],
        } });
        // Existing settings and prefilter decide whether to call an LLM. Never enable AI here.
        await queuePostAfterScrape(target.id);
        imported++;
      }
      if (!data.posts.length) break;
      const last = data.posts[data.posts.length - 1];
      await prisma.setting.upsert({ where:{key:cursorKey}, create:{key:cursorKey,value:[last.last_observed_at,last.group_id,last.post_id]}, update:{value:[last.last_observed_at,last.group_id,last.post_id]} });
      if (data.posts.length < 200) break;
    }
    status = { ...status, imported, lastSyncAt:new Date().toISOString(), error:null };
  } catch {
    // Do not expose child stderr or provider errors, which may contain private content.
    status = { ...status, imported, error:'Collector handoff failed. Check the source database, Python executable and application database; unsynced records will retry.' };
  }
  return collectorBridgeStatus();
}

export function syncCollectorBridge() {
  if (!pending) pending = run().finally(() => { pending = undefined; });
  return pending;
}
export function startCollectorBridge() {
  void syncCollectorBridge();
  const timer = setInterval(() => { void syncCollectorBridge(); }, 30000);
  timer.unref();
  return () => clearInterval(timer);
}
