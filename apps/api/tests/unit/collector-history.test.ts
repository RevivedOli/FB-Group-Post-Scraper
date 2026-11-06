import {describe,it,expect,vi} from 'vitest';
vi.mock('../../src/db/prisma.js',()=>({prisma:{}}));
import {cycleMetrics,type CycleRecord} from '../../src/services/collector-history.service.js';
describe('collection history metrics',()=>{
 it('preserves all group outcomes, elapsed time and settings without counting samples as saved posts',()=>{
 const run:CycleRecord={id:'x',state:'completed',mode:'run',total:2,completed:2,startedAt:'2026-11-05T20:00:00Z',finishedAt:'2026-11-05T20:02:00Z',settings:{stopAfterKnown:10},events:[
 {type:'group_started',ui_id:'a',name:'A',at:'2026-11-05T20:00:10Z'},
 {type:'group_result',ui_id:'a',status:'collected',at:'2026-11-05T20:01:00Z',result:{posts_fetched:15,new_posts:5,duplicates:10,pages:3,stop_reason:'known_post_streak',consecutive_known:10}},
 {type:'group_started',ui_id:'b',name:'B',at:'2026-11-05T20:01:20Z'},
 {type:'group_result',ui_id:'b',status:'access_unverified',at:'2026-11-05T20:01:30Z'}]};
 const m=cycleMetrics(run);
 expect(m.durationSeconds).toBe(120);expect(m.groups[0].durationSeconds).toBe(50);
 expect([m.postsFetched,m.newPosts,m.duplicates,m.pages,m.collected,m.issues]).toEqual([15,5,10,3,1,1]);
 expect(m.stopReasons).toEqual({known_post_streak:1,access_unverified:1});
 expect(m.settings.stopAfterKnown).toBe(10);
 });
 it('retains an unfinished group on cancellation',()=>{
 const m=cycleMetrics({id:'x',state:'cancelled',mode:'run',total:2,completed:0,startedAt:'2026-11-05T20:00:00Z',finishedAt:'2026-11-05T20:00:05Z',settings:{},events:[{type:'group_started',ui_id:'a',at:'2026-11-05T20:00:01Z'}]});
 expect(m.groups[0].status).toBe('not_completed');expect(m.groups[0].durationSeconds).toBeNull();
 });
});
