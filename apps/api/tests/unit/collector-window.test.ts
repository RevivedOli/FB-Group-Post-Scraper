import {describe,it,expect,vi,beforeEach} from 'vitest';
import {defaultWindow,isAllowedStart,nextAllowedStart,normalizeWindow} from '../../src/services/collector-window.js';
const mocks=vi.hoisted(()=>({find:vi.fn(),save:vi.fn(),status:vi.fn(),start:vi.fn()}));
vi.mock('../../src/db/prisma.js',()=>({prisma:{setting:{findUnique:mocks.find,upsert:mocks.save}}}));
vi.mock('../../src/services/collector-worker.service.js',()=>({collectorWorkerStatus:mocks.status,startCollectorWorker:mocks.start}));
import {tickRecurring} from '../../src/services/collector-schedule.service.js';
describe('collection windows',()=>{
 it('includes opening time, excludes closing time and waits overnight',()=>{
 expect(isAllowedStart(defaultWindow,new Date('2026-11-06T06:00:00Z'))).toBe(true);
 expect(isAllowedStart(defaultWindow,new Date('2026-11-06T00:00:00Z'))).toBe(false);
 expect(nextAllowedStart(defaultWindow,new Date('2026-11-06T00:10:00Z')).toISOString()).toBe('2026-11-06T06:00:00.000Z');
 });
 it('skips unselected days and associates overnight windows with their opening day',()=>{
 const w={...defaultWindow,allowedDays:[5],windowStart:'22:00',windowEnd:'02:00'};
 expect(isAllowedStart(w,new Date('2026-11-07T01:00:00Z'))).toBe(true);
 expect(isAllowedStart(w,new Date('2026-11-07T22:00:00Z'))).toBe(false);
 expect(nextAllowedStart(w,new Date('2026-11-07T02:00:00Z')).toISOString()).toBe('2026-11-13T22:00:00.000Z');
 });
 it('uses London local time through daylight saving changes',()=>{
 expect(nextAllowedStart(defaultWindow,new Date('2026-07-01T01:00:00Z')).toISOString()).toBe('2026-07-01T05:00:00.000Z');
 const w={...defaultWindow,windowStart:'01:30',windowEnd:'03:00'};
 expect(nextAllowedStart(w,new Date('2026-03-29T00:59:00Z')).toISOString()).toBe('2026-03-29T01:00:00.000Z');
 });
 it('validates days, times and timezone and supports unrestricted starts',()=>{
 for(const patch of [{allowedDays:[]},{allowedDays:[8]},{windowStart:'24:00'},{windowEnd:'06:00'},{timeZone:'bad'}])expect(()=>normalizeWindow(patch)).toThrow();
 expect(isAllowedStart({...defaultWindow,windowEnabled:false},new Date('2026-11-06T02:00:00Z'))).toBe(true);
 });
});
describe('recurring start gate',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.find.mockResolvedValue({value:{...defaultWindow,enabled:true,nextRunAt:'2026-11-05T23:59:00Z'}});mocks.status.mockReturnValue({state:'idle',events:[]});mocks.save.mockResolvedValue({});});
 it('defers a due cycle outside allowed hours',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-06T01:00:00Z'));
 try{await tickRecurring();expect(mocks.start).not.toHaveBeenCalled();expect(mocks.save.mock.calls[0][0].update.value.nextRunAt).toBe('2026-11-06T06:00:00.000Z');}finally{vi.useRealTimers();}
 });
 it('starts a due cycle inside allowed hours',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-06T23:50:00Z'));
 try{await tickRecurring();expect(mocks.start).toHaveBeenCalledOnce();}finally{vi.useRealTimers();}
 });
 it('does not stop a running cycle when the window closes',async()=>{
 mocks.status.mockReturnValue({state:'running',events:[]});
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-06T01:00:00Z'));
 try{await tickRecurring();expect(mocks.start).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();}finally{vi.useRealTimers();}
 });
});
