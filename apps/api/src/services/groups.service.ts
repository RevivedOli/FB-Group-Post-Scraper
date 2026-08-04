import { prisma } from '../db/prisma.js';
import { normalizeFacebookGroupUrl } from './url-normalizer.js';
export async function listGroups(){ return prisma.group.findMany({orderBy:{displayOrder:'asc'}}); }
export async function createGroup(input:{facebookGroupUrl:string; friendlyName?:string; location?:string; notes?:string; enabled?:boolean}){ const canonicalGroupUrl=normalizeFacebookGroupUrl(input.facebookGroupUrl); const count=await prisma.group.count(); return prisma.group.create({data:{facebookGroupUrl:input.facebookGroupUrl, canonicalGroupUrl, friendlyName:input.friendlyName?.trim() || canonicalGroupUrl.split('/').pop() || 'Facebook group', location:input.location, notes:input.notes, enabled:input.enabled ?? true, displayOrder:count}}); }
export async function updateGroup(id:string,input:any){ const data={...input}; if(input.facebookGroupUrl) data.canonicalGroupUrl=normalizeFacebookGroupUrl(input.facebookGroupUrl); return prisma.group.update({where:{id},data}); }
export async function deleteGroup(id:string){
  const runs = await prisma.scrapeRun.findMany({ where: { groupId: id }, select: { id: true } });
  const runIds = runs.map((run) => run.id);
  const [, , group] = await prisma.$transaction([
    prisma.scrapeEvent.deleteMany({ where: { scrapeRunId: { in: runIds } } }),
    prisma.scrapeRun.deleteMany({ where: { groupId: id } }),
    prisma.group.delete({ where: { id } }),
  ]);
  return group;
}
export async function clearGroupData(id:string){
  const runs = await prisma.scrapeRun.findMany({ where: { groupId: id }, select: { id: true } });
  const runIds = runs.map((run) => run.id);
  const [events, posts, scrapeRuns, group] = await prisma.$transaction([
    prisma.scrapeEvent.deleteMany({ where: { scrapeRunId: { in: runIds } } }),
    prisma.post.deleteMany({ where: { groupId: id } }),
    prisma.scrapeRun.deleteMany({ where: { groupId: id } }),
    prisma.group.update({
      where: { id },
      data: {
        baselineStatus: 'never_scanned',
        baselineCompletedAt: null,
        lastSuccessfulMonitorAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    }),
  ]);

  return {
    group,
    deletedPosts: posts.count,
    deletedRuns: scrapeRuns.count,
    deletedEvents: events.count,
  };
}
export async function reorderGroups(ids:string[]){ await prisma.$transaction(ids.map((id,displayOrder)=>prisma.group.update({where:{id},data:{displayOrder}}))); return listGroups(); }
