import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const mocks=vi.hoisted(()=>({spawn:vi.fn(),findSetting:vi.fn(),saveSetting:vi.fn(),findMany:vi.fn(),update:vi.fn(),sync:vi.fn()}));
vi.mock('node:child_process',()=>({spawn:mocks.spawn}));
vi.mock('../../src/db/prisma.js',()=>({prisma:{setting:{findUnique:mocks.findSetting,upsert:mocks.saveSetting},group:{findMany:mocks.findMany,update:mocks.update}}}));
vi.mock('../../src/services/collector-bridge.service.js',()=>({syncCollectorBridge:mocks.sync}));
import {collectorWorkerStatus,startCollectorWorker,stopCollectorWorker} from '../../src/services/collector-worker.service.js';
let child:EventEmitter&{stdout:PassThrough;stderr:PassThrough;stdin:PassThrough;kill:ReturnType<typeof vi.fn>};
const flush=async()=>{await new Promise(resolve=>setImmediate(resolve));};
beforeEach(()=>{
  vi.clearAllMocks();child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),kill:vi.fn()});
  mocks.findSetting.mockResolvedValue(null);mocks.spawn.mockReturnValue(child);mocks.findMany.mockResolvedValue([{id:'g1',friendlyName:'Example',canonicalGroupUrl:'https://www.facebook.com/groups/123',facebookGroupId:null}]);mocks.update.mockResolvedValue({});mocks.sync.mockResolvedValue({});
});
describe('sequential collector worker control',()=>{
  it('starts one Python child, rejects a second cycle and persists access results',async()=>{
    let payload='';child.stdin.on('data',chunk=>{payload+=chunk;});
    await startCollectorWorker({mode:'test',groupIds:['g1']});
    await expect(startCollectorWorker({mode:'run'})).rejects.toThrow('already running');
    expect(mocks.spawn.mock.calls[0][1]).toEqual(['-m','facebook_collector.ui_worker']);
    expect(JSON.parse(payload).groups[0].reference).toBe('https://www.facebook.com/groups/123');
    child.stdout.write(JSON.stringify({type:'group_result',ui_id:'g1',status:'accessible',name:'Example'})+'\n');
    child.emit('close',0);await flush();
    expect(mocks.update).toHaveBeenCalled();expect(mocks.sync).toHaveBeenCalled();
    expect(collectorWorkerStatus().state).toBe('completed');
    const saved=mocks.saveSetting.mock.calls.at(-1)?.[0].update.value;
    expect(saved.state).toBe('completed');expect(saved.finishedAt).toBeTruthy();
    expect(saved.settings.stopAfterKnown).toBe(10);
    expect(saved.events.some((event:{type:string})=>event.type==='group_result')).toBe(true);
  });
  it('signals cancellation and leaves the worker stopped',async()=>{
    await startCollectorWorker({mode:'run'});stopCollectorWorker();expect(child.kill).toHaveBeenCalledWith('SIGINT');child.emit('close',130);await flush();
    expect(collectorWorkerStatus().state).toBe('cancelled');
  });
  it('forces a stuck worker to exit and permits a fresh cycle',async()=>{
    vi.useFakeTimers();
    try {
      await startCollectorWorker({mode:'run'});
      stopCollectorWorker();stopCollectorWorker();
      expect(child.kill).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5000);
      expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
      child.emit('close',null);
      await vi.advanceTimersByTimeAsync(0);
      expect(collectorWorkerStatus().state).toBe('cancelled');
      child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),kill:vi.fn()});
      mocks.spawn.mockReturnValue(child);
      await startCollectorWorker({mode:'test'});
      child.emit('close',0);
      await vi.advanceTimersByTimeAsync(0);
    } finally {vi.useRealTimers();}
  });
  it('validates limits before starting a process',async()=>{
    await expect(startCollectorWorker({mode:'run',maxPages:999})).rejects.toThrow('Invalid');expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
