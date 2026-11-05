import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {enqueueReferralNotifications} from '../../src/services/notifications.service.js';
let directory:string;let db:PrismaClient;
const config={enabled:true,chatId:'123',minMatchPercent:80,enabledAt:'2026-11-04T00:00:00Z'};
const post={id:'post-1',firstDiscoveredAt:new Date('2026-11-04T01:00:00Z'),originalPostedAt:null,latestCapturedText:'Need a local boiler engineer',canonicalPostUrl:'https://www.facebook.com/groups/123/posts/456'};
const members=[{id:'member-1',name:'Example'}],matches=[{referralMemberId:'member-1',score:1,scorePercent:'100%'}];
beforeAll(async()=>{
 directory=await mkdtemp(path.join(os.tmpdir(),'group-monitor-notifications-'));
 db=new PrismaClient({datasourceUrl:`file:${path.join(directory,'test.sqlite')}`});
 const sql=await readFile(new URL('../../../../prisma/migrations/20261104223000_notification_delivery/migration.sql',import.meta.url),'utf8');
 for(const statement of sql.split(';').filter(value=>value.trim()))await db.$executeRawUnsafe(statement);
});
afterAll(async()=>{await db?.$disconnect();if(directory)await rm(directory,{recursive:true,force:true});});
describe('durable SQLite notification transaction',()=>{
 it('stores one delivery across repeated assessment commits',async()=>{
  for(let n=0;n<2;n++)await db.$transaction(tx=>enqueueReferralNotifications(tx,config,post,members,matches));
  expect(await db.notificationDelivery.count()).toBe(1);
 });
 it('rolls back the alert if the parent transaction fails',async()=>{
  await expect(db.$transaction(async tx=>{await enqueueReferralNotifications(tx,config,{...post,id:'post-2'},members,matches);throw new Error('Simulated assessment commit failure');})).rejects.toThrow('Simulated');
  expect(await db.notificationDelivery.count({where:{postId:'post-2'}})).toBe(0);
 });
});
