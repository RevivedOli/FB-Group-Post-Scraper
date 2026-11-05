import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { prisma } from '../db/prisma.js';
import { syncCollectorBridge } from './collector-bridge.service.js';
import { normalizePacing, type CollectorPacing } from './collector-pacing.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
let child:ChildProcess|undefined;
let starting = false;
type Event = { type:string; ui_id?:string; name?:string; status?:string; message?:string; reason?:string; account_id?:string; facebook_profile_id?:string; result?:Record<string,unknown>; at:string };
let job = { state:'idle', mode:'test', currentGroup:null as string|null, accountId:null as string|null, profileId:null as string|null, total:0, completed:0, events:[] as Event[], startedAt:null as string|null, finishedAt:null as string|null };
export function collectorWorkerStatus() { return {...job,events:[...job.events]}; }
function event(value:Omit<Event,'at'>) { job.events.unshift({...value,at:new Date().toISOString()}); job.events = job.events.slice(0,100); }
export function stopCollectorWorker() { if (child) { job.state='stopping'; child.kill('SIGINT'); } return collectorWorkerStatus(); }
export async function startCollectorWorker(input:Partial<CollectorPacing>&{mode?:unknown;groupIds?:unknown;maxAgeHours?:unknown;maxPages?:unknown;limit?:unknown}) {
  if (child || starting) throw new Error('A collector cycle is already running. Stop it or wait for completion.');
  starting = true;
  try {
    if (input.mode !== 'test' && input.mode !== 'run') throw new Error('Invalid collector mode');
    if (input.groupIds !== undefined && (!Array.isArray(input.groupIds) || !input.groupIds.length || input.groupIds.length > 100 || !input.groupIds.every(id=>typeof id==='string'))) throw new Error('Invalid group selection');
    const savedPacing=await prisma.setting.findUnique({where:{key:'collector.recurring.v1'}});
    const pacing=normalizePacing({...savedPacing?.value as Partial<CollectorPacing>,...input});
    const maxAgeHours=Number(input.maxAgeHours ?? 7), maxPages=Number(input.maxPages ?? 5), limit=Number(input.limit ?? 50);
    if (!Number.isFinite(maxAgeHours) || maxAgeHours<=0 || maxAgeHours>8760 || !Number.isInteger(maxPages) || maxPages<1 || maxPages>20 || !Number.isInteger(limit) || limit<1 || limit>500) throw new Error('Invalid collection limits');
    const groups = await prisma.group.findMany({where:input.groupIds ? {id:{in:input.groupIds as string[]}} : {enabled:true},orderBy:{displayOrder:'asc'}});
    if (!groups.length) throw new Error('No groups selected. Enable groups or select one group.');
    job={state:'running',mode:input.mode,currentGroup:null,accountId:null,profileId:null,total:groups.length,completed:0,events:[],startedAt:new Date().toISOString(),finishedAt:null};
    const payload = { mode:input.mode, max_age_hours:maxAgeHours, max_pages:maxPages, limit,
      pacing, data_dir:process.env.FACEBOOK_COLLECTOR_DATA_DIR,
      groups:groups.map(group=>({ui_id:group.id,name:group.friendlyName,reference:group.facebookGroupId && /^\d+$/.test(group.facebookGroupId) ? group.facebookGroupId : group.canonicalGroupUrl})),
    };
    const processChild=spawn(process.env.COLLECTOR_PYTHON ?? path.join(root,'facebook_collector/.venv/bin/python'),['-m','facebook_collector.ui_worker'],{cwd:root,stdio:['pipe','pipe','pipe']});
    child=processChild;
    let updates=Promise.resolve();
    const lines=createInterface({input:processChild.stdout!});
    lines.on('line',line=>{
      if (line.length>100000) return;
      let value:Omit<Event,'at'>;
      try { value=JSON.parse(line); } catch { return; }
      event(value);
      if (value.type==='started') { job.accountId=value.account_id ?? null;job.profileId=value.facebook_profile_id ?? null; }
      if (value.type==='group_started') job.currentGroup=value.name ?? null;
      if (value.type==='stopped') job.state=value.reason==='cancelled' ? 'cancelled' : 'stopped';
      if (value.type==='group_result') {
        job.completed++;
        updates=updates.then(async()=>{
          await prisma.group.update({where:{id:value.ui_id},data:{
            lastTestedAt:new Date(),lastTestStatus:value.status==='collected' ? 'accessible' : value.status,
            lastErrorMessage:value.message ?? (value.status==='feed_unverified' ? 'Group header loaded, but post access remains unverified.' : null),
            ...(value.status==='collected' ? {lastSuccessfulMonitorAt:new Date()} : {}),
          }});
          await syncCollectorBridge();
        }).catch(()=>{ event({type:'warning',message:'Unable to update application status; collector scan history and posts remain saved.'}); });
      }
    });
    processChild.stderr?.on('data',()=>{}); // Never expose upstream stderr or credentials.
    processChild.once('error',()=>{ event({type:'stopped',reason:'worker_start_failed',message:'Check the collector virtualenv/Python path.'}); job.state='failed'; });
    processChild.once('close',code=>{ void updates.finally(()=>{
      if (job.state==='running') job.state=code===0 ? 'completed' : 'failed';
      if (job.state==='stopping') job.state='cancelled';
      job.currentGroup=null;job.finishedAt=new Date().toISOString();child=undefined;
    }); });
    processChild.stdin!.end(JSON.stringify(payload));
    return collectorWorkerStatus();
  } finally { starting=false; }
}
