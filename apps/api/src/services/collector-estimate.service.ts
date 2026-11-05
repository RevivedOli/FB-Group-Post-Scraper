import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizePacing,type CollectorPacing} from './collector-pacing.js';
import {prisma} from '../db/prisma.js';
const exec=promisify(execFile);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
type Group={canonicalGroupUrl:string;facebookGroupId:string|null};
type Timing={group_id:string;started_at:string;finished_at:string;pages:number;posts_fetched:number};
function median(values:number[]){const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.floor(sorted.length/2)]:undefined;}
export function estimateCycle(groups:Group[],history:Timing[],maxPages:number,limit:number,pacing?:Partial<CollectorPacing>){
 const settings=normalizePacing(pacing ?? {requestMinSeconds:5,requestMaxSeconds:5,pageMinSeconds:10,pageMaxSeconds:10,groupMinSeconds:10,groupMaxSeconds:10});
 const pageStep=(settings.pageMinSeconds+settings.pageMaxSeconds+settings.requestMinSeconds+settings.requestMaxSeconds)/2;
 const groupStep=(settings.groupMinSeconds+settings.groupMaxSeconds)/2;
 const valid=history.map(row=>({...row,seconds:(Date.parse(row.finished_at)-Date.parse(row.started_at))/1000})).filter(row=>Number.isFinite(row.seconds)&&row.seconds>0&&row.seconds<=240&&row.pages>0);
 const globalBase=median(valid.map(row=>Math.max(5,row.seconds-(row.pages-1)*15))) ?? 12;
 let seconds=0,measuredGroups=0,skippedGroups=0;
 for(const group of groups){
  const id=group.facebookGroupId && /^\d+$/.test(group.facebookGroupId)?group.facebookGroupId:/\/groups\/(\d+)\/?$/.exec(group.canonicalGroupUrl)?.[1];
  if(!id){skippedGroups++;continue;}
  const samples=valid.filter(row=>row.group_id===id).slice(0,10);
  if(samples.length)measuredGroups++;
  const base=median(samples.map(row=>Math.max(5,row.seconds-(row.pages-1)*15))) ?? globalBase;
  const size=median(samples.filter(row=>row.posts_fetched>0).map(row=>row.posts_fetched/row.pages)) ?? 3;
  const pages=Math.min(maxPages,Math.max(1,Math.ceil(limit/Math.max(1,size))));
  seconds+=Math.min(settings.groupDeadlineSeconds,base+(pages-1)*pageStep);
 }
 seconds+=Math.max(0,groups.length-1)*groupStep;
 return {enabledGroups:groups.length,processableGroups:groups.length-skippedGroups,skippedGroups,measuredGroups,sampleCount:valid.length,
  lowerMinutes:groups.length?Math.max(1,Math.floor(seconds*0.75/60)):0,
  upperMinutes:groups.length?Math.max(1,Math.ceil(seconds*1.4/60)):0,
  estimatedSeconds:Math.round(seconds),basis:valid.length?'recent scan timings and configured page/post caps':'request spacing and configured page/post caps'};
}
export async function getCycleEstimate(maxPages:number,limit:number,pacing?:Partial<CollectorPacing>){
 if(!Number.isInteger(maxPages)||maxPages<1||maxPages>20||!Number.isInteger(limit)||limit<1||limit>500)throw new Error('Enter valid page/post limits to estimate runtime.');
 const groups=await prisma.group.findMany({where:{enabled:true},select:{canonicalGroupUrl:true,facebookGroupId:true}});
 let history:Timing[]=[];
 try{const source=path.resolve(process.env.FACEBOOK_COLLECTOR_DATA_DIR ?? path.join(root,'facebook_collector/data'),'collector.db');const {stdout}=await exec(process.env.COLLECTOR_PYTHON ?? 'python3',[path.join(root,'facebook_collector/scripts/scan_timings.py'),source],{timeout:10000,maxBuffer:500000});history=JSON.parse(stdout);}catch{/* First-run estimate uses request spacing only. */}
 return estimateCycle(groups,history,maxPages,limit,pacing);
}
