import {describe,expect,it} from 'vitest';
import {estimateCycle} from '../../src/services/collector-estimate.service.js';
const groups=[{canonicalGroupUrl:'https://www.facebook.com/groups/123',facebookGroupId:null}];
const history=[{group_id:'123',started_at:'2026-11-04T12:00:00Z',finished_at:'2026-11-04T12:00:25Z',pages:2,posts_fetched:6}];
describe('collection runtime estimate',()=>{
 it('uses observed scan timing and increases with the configured page cap',()=>{const short=estimateCycle(groups,history,2,50),long=estimateCycle(groups,history,5,50);expect(short.estimatedSeconds).toBe(25);expect(long.estimatedSeconds).toBe(70);expect(long.measuredGroups).toBe(1);expect(long.sampleCount).toBe(1);});
 it('accounts for sequential group pauses and unresolved named groups',()=>{const result=estimateCycle([...groups,{canonicalGroupUrl:'https://www.facebook.com/groups/example',facebookGroupId:null}],history,2,50);expect(result.estimatedSeconds).toBe(35);expect(result.skippedGroups).toBe(1);expect(result.enabledGroups).toBe(2);});
 it('uses a finite first-run estimate and no duration for an empty list',()=>{expect(estimateCycle(groups,[],5,50).estimatedSeconds).toBe(72);expect(estimateCycle([],[],5,50).upperMinutes).toBe(0);});
 it('honours a small post cap and ignores invalid timing samples',()=>{expect(estimateCycle(groups,history,5,1).estimatedSeconds).toBe(10);expect(estimateCycle(groups,[{...history[0],finished_at:'invalid'}],5,50).sampleCount).toBe(0);});
});
