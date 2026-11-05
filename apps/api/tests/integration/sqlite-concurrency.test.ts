import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {sqliteRuntimeUrl} from '../../src/db/sqlite-runtime.js';
let dir:string,writer:PrismaClient,reader:PrismaClient;
beforeAll(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'sqlite-ui-concurrency-'));const url=sqliteRuntimeUrl(`file:${path.join(dir,'test.sqlite')}`);writer=new PrismaClient({datasourceUrl:url});reader=new PrismaClient({datasourceUrl:url});await writer.$queryRawUnsafe('PRAGMA journal_mode=WAL');await writer.$executeRawUnsafe('CREATE TABLE Example(id INTEGER PRIMARY KEY,value INTEGER)');await writer.$executeRawUnsafe('INSERT INTO Example VALUES(1,1)');});
afterAll(async()=>{await writer?.$disconnect();await reader?.$disconnect();if(dir)await rm(dir,{recursive:true,force:true});});
describe('WAL UI-reader and background-writer isolation',()=>{
 it('allows another client to read committed state during a write transaction',async()=>{
  await writer.$transaction(async tx=>{await tx.$executeRawUnsafe('UPDATE Example SET value=2 WHERE id=1');expect(await reader.$queryRawUnsafe('SELECT value FROM Example')).toEqual([{value:1}]);});
  expect(await reader.$queryRawUnsafe('SELECT value FROM Example')).toEqual([{value:2}]);
 });
});
