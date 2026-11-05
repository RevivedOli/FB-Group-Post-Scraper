import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({find:vi.fn(),save:vi.fn(),status:vi.fn(),start:vi.fn()}));
vi.mock('../../src/db/prisma.js',()=>({prisma:{setting:{findUnique:mocks.find,upsert:mocks.save}}}));
vi.mock('../../src/services/collector-worker.service.js',()=>({collectorWorkerStatus:mocks.status,startCollectorWorker:mocks.start}));
import {tickRecurring,updateRecurring} from '../../src/services/collector-schedule.service.js';
const config={enabled:true,intervalMinutes:60,maxAgeHours:7,maxPages:5,limit:50,nextRunAt:'2020-01-01T00:00:00Z',lastStartedAt:null,lastError:null};
beforeEach(()=>{vi.clearAllMocks();mocks.find.mockResolvedValue({value:config});mocks.status.mockReturnValue({state:'idle',events:[]});mocks.start.mockResolvedValue({});});
describe('recurring collection',()=>{
 it('persists next due time before dispatching a bounded cycle',async()=>{await tickRecurring();expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({mode:'run',maxAgeHours:7,maxPages:5,limit:50}));expect(mocks.save.mock.calls[0][0].update.value.nextRunAt).toBeNull();expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.start.mock.invocationCallOrder[0]);});
 it('waits a fresh sampled interval after a cycle completes',async()=>{
  const finishedAt=new Date().toISOString();mocks.status.mockReturnValue({state:'completed',mode:'run',finishedAt,events:[]});
  const random=vi.spyOn(Math,'random').mockReturnValue(0.5);
  await tickRecurring();random.mockRestore();
  const next=mocks.save.mock.calls[0][0].update.value;
  expect(Date.parse(next.nextRunAt)-Date.now()).toBeGreaterThan(67*60000);
  expect(next.lastFinishedAt).toBe(finishedAt);expect(mocks.start).not.toHaveBeenCalled();
 });
 it('does not overlap a currently running worker',async()=>{mocks.status.mockReturnValue({state:'running',events:[]});await tickRecurring();expect(mocks.start).not.toHaveBeenCalled();});
 it('pauses on authentication/security failures instead of retrying on schedule',async()=>{mocks.status.mockReturnValue({state:'stopped',mode:'run',events:[{type:'stopped',reason:'restricted'}]});await tickRecurring();expect(mocks.save.mock.calls[0][0].update.value.enabled).toBe(false);expect(mocks.start).not.toHaveBeenCalled();});
 it('does not treat a pre-enablement failure as a new scheduled failure',async()=>{mocks.find.mockResolvedValue({value:{...config,enabledAt:'2026-11-04T12:00:00Z',nextRunAt:'2099-01-01T00:00:00Z'}});mocks.status.mockReturnValue({state:'stopped',mode:'run',events:[{type:'stopped',reason:'restricted',at:'2026-11-03T12:00:00Z'}]});await tickRecurring();expect(mocks.save).not.toHaveBeenCalled();});
 it('accepts exactly fifteen minutes with valid limits',async()=>{await updateRecurring({intervalMinutes:15});expect(mocks.save.mock.calls[0][0].update.value.intervalMinutes).toBe(15);});
 it('identifies the actual invalid field instead of blaming the interval',async()=>{await expect(updateRecurring({intervalMinutes:15,maxPages:21})).rejects.toThrow('Max pages');await expect(updateRecurring({intervalMinutes:15,limit:0})).rejects.toThrow('Max posts');await expect(updateRecurring({intervalMinutes:15,maxAgeHours:0})).rejects.toThrow('Look back');});
 it('rejects overly frequent intervals',async()=>{await expect(updateRecurring({intervalMinutes:1})).rejects.toThrow('minimum must be at least 15');});
});
