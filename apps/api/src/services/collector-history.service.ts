import {randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {prisma} from '../db/prisma.js';
const prefix='collector.cycle.v1.';
export type CycleRecord={id:string;state:string;mode:string;total:number;completed:number;startedAt:string;finishedAt:string|null;settings:Record<string,unknown>;events:Array<Record<string,any>>;recovered?:boolean};
export function newCycleRecord(job:{state:string;mode:string;total:number;completed:number;startedAt:string|null;finishedAt:string|null},settings:Record<string,unknown>):CycleRecord {
 return {...job,id:randomUUID(),startedAt:job.startedAt??new Date().toISOString(),settings,events:[]};
}
export async function saveCycle(record:CycleRecord){
 const value=JSON.parse(JSON.stringify(record)) as Prisma.InputJsonObject;
 await prisma.setting.upsert({where:{key:prefix+record.id},create:{key:prefix+record.id,value},update:{value}});
}
export function cycleMetrics(record:CycleRecord){
 const results=record.events.filter(e=>e.type==='group_result');
 const sum=(key:string)=>results.reduce((n,e)=>n+Number(e.result?.[key]??0),0);
 const stops:Record<string,number>={};
 for(const e of results){const reason=e.result?.stop_reason??e.status;stops[reason]=(stops[reason]??0)+1;}
 const end=record.finishedAt??(record.state==='interrupted'?record.events.at(-1)?.at??record.startedAt:new Date().toISOString());
 return {...record,durationSeconds:Math.max(0,(Date.parse(end)-Date.parse(record.startedAt))/1000),postsFetched:sum('posts_fetched'),newPosts:sum('new_posts'),duplicates:sum('duplicates'),pages:sum('pages'),collected:results.filter(e=>e.status==='collected').length,issues:results.filter(e=>!['collected','accessible'].includes(e.status)).length,stopReasons:stops,
 groups:record.events.filter(e=>e.type==='group_started').map(start=>{
 const result=results.find(e=>e.ui_id===start.ui_id);
 return {id:start.ui_id,name:start.name,startedAt:start.at,finishedAt:result?.at??null,durationSeconds:result?Math.max(0,(Date.parse(result.at)-Date.parse(start.at))/1000):null,status:result?.status??(record.finishedAt?'not_completed':'running'),message:result?.message,result:result?.result};
 })};
}
export async function listCycles(page=1,pageSize=10,activeStartedAt:string|null=null){
 page=Math.max(1,Math.floor(page)||1);pageSize=Math.min(50,Math.max(1,Math.floor(pageSize)||10));
 const rows=await prisma.setting.findMany({where:{key:{startsWith:prefix}},select:{value:true}});
 const all=rows.map(r=>r.value as unknown as CycleRecord).map(record=>!record.finishedAt&&record.startedAt!==activeStartedAt?{...record,state:'interrupted'}:record).sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
 return {items:all.slice((page-1)*pageSize,page*pageSize).map(record=>{const {events,...metrics}=cycleMetrics(record);return metrics;}),total:all.length,page,pageSize};
}
