import { prisma } from '../db/prisma.js';
import { collectorWorkerStatus, startCollectorWorker } from './collector-worker.service.js';
import { normalizePacing, randomBetween, type CollectorPacing } from './collector-pacing.js';
const key='collector.recurring.v1';
export type RecurringConfig=CollectorPacing&{enabled:boolean;intervalMinutes:number;maxAgeHours:number;maxPages:number;limit:number;nextRunAt:string|null;lastStartedAt:string|null;lastError:string|null;enabledAt:string|null;lastFinishedAt:string|null};
const defaults:RecurringConfig={...normalizePacing({}),enabled:false,intervalMinutes:60,maxAgeHours:7,maxPages:5,limit:50,nextRunAt:null,lastStartedAt:null,lastError:null,enabledAt:null,lastFinishedAt:null};
export async function recurringConfig():Promise<RecurringConfig>{const row=await prisma.setting.findUnique({where:{key}});const saved=row?.value as Partial<RecurringConfig> ?? {};return {...defaults,...saved,...normalizePacing(saved)};}
async function store(value:RecurringConfig){await prisma.setting.upsert({where:{key},create:{key,value},update:{value}});return value;}
export async function updateRecurring(input:Partial<RecurringConfig>){
  const previous=await recurringConfig();const patch={...input};
  if(input.intervalMinutes!==undefined&&input.intervalMinMinutes===undefined){patch.intervalMinMinutes=Number(input.intervalMinutes);patch.intervalMaxMinutes=Number(input.intervalMinutes);}
  const pacing=normalizePacing({...previous,...patch});
  const value={...previous,...pacing,intervalMinutes:pacing.intervalMinMinutes};
  for(const field of ['maxAgeHours','maxPages','limit'] as const)if(input[field]!==undefined)value[field]=Number(input[field]);
  if(input.enabled!==undefined)value.enabled=Boolean(input.enabled);

  if(!Number.isFinite(value.maxAgeHours)||value.maxAgeHours<=0||value.maxAgeHours>8760)throw new Error('Look back must be greater than 0 and no more than 8,760 hours.');
  if(!Number.isInteger(value.maxPages)||value.maxPages<1||value.maxPages>20)throw new Error('Max pages per group must be a whole number between 1 and 20.');
  if(!Number.isInteger(value.limit)||value.limit<1||value.limit>500)throw new Error('Max posts per group must be a whole number between 1 and 500.');
  if(value.enabled&&(!previous.enabled||value.intervalMinMinutes!==previous.intervalMinMinutes||value.intervalMaxMinutes!==previous.intervalMaxMinutes)){value.nextRunAt=new Date(Date.now()+randomBetween(value.intervalMinMinutes,value.intervalMaxMinutes)*60000).toISOString();value.enabledAt=new Date().toISOString();}
  if(!value.enabled)value.nextRunAt=null;
  value.lastError=null;return store(value);
}
let ticking=false;
export async function tickRecurring(){
  if(ticking)return;ticking=true;
  try{
    const config=await recurringConfig();if(!config.enabled)return;
    const status=collectorWorkerStatus();
    const stop=status.events.find(event=>event.type==='stopped');
    if(status.mode==='run'&&status.state==='stopped'&&stop&&(!config.enabledAt||new Date(stop.at).getTime()>=new Date(config.enabledAt).getTime())&&['restricted','authentication_required','authentication_unverified'].includes(stop.reason ?? '')){await store({...config,enabled:false,nextRunAt:null,lastError:'Collection paused: complete the Facebook login/security check before re-enabling the schedule.'});return;}
    if(['running','stopping'].includes(status.state))return;
    if(status.mode==='run'&&status.finishedAt&&(!config.lastFinishedAt||Date.parse(status.finishedAt)>Date.parse(config.lastFinishedAt))&&(!config.enabledAt||Date.parse(status.finishedAt)>=Date.parse(config.enabledAt))){
      await store({...config,lastFinishedAt:status.finishedAt,nextRunAt:new Date(Date.now()+randomBetween(config.intervalMinMinutes,config.intervalMaxMinutes)*60000).toISOString()});return;
    }
    // Restart during a cycle: restore a full pause rather than replaying immediately.
    if(!config.nextRunAt){await store({...config,nextRunAt:new Date(Date.now()+randomBetween(config.intervalMinMinutes,config.intervalMaxMinutes)*60000).toISOString()});return;}
    if(new Date(config.nextRunAt).getTime()>Date.now())return;
    const now=new Date().toISOString();
    // Persist the next due time before dispatch, avoiding immediate replay on restart.
    await store({...config,lastStartedAt:now,nextRunAt:null,lastError:null});
    try{await startCollectorWorker({...normalizePacing(config),mode:'run',maxAgeHours:config.maxAgeHours,maxPages:config.maxPages,limit:config.limit});}
    catch{await store({...config,enabled:false,nextRunAt:null,lastError:'Recurring collection could not start. Check enabled groups and the saved collector login.'});}
  }finally{ticking=false;}
}
export function startRecurringCollector(){const tick=()=>{void tickRecurring().catch(()=>{});};tick();const timer=setInterval(tick,15000);timer.unref();return()=>clearInterval(timer);}
