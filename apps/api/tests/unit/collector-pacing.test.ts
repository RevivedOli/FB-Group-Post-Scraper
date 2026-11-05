import {describe,expect,it} from 'vitest';
import {normalizePacing,randomBetween} from '../../src/services/collector-pacing.js';
describe('collector timing ranges',()=>{
 it('retains the old interval as the minimum and adds a longer maximum',()=>{expect(normalizePacing({intervalMinutes:15})).toMatchObject({intervalMinMinutes:15,intervalMaxMinutes:30,shuffleGroups:true});});
 it('accepts fixed ranges and samples within min/max',()=>{expect(randomBetween(5,10,()=>0)).toBe(5);expect(randomBetween(5,10,()=>0.5)).toBe(7.5);expect(randomBetween(10,10,()=>0.7)).toBe(10);});
 it('rejects reversed, nonfinite or overly aggressive bounds',()=>{expect(()=>normalizePacing({requestMinSeconds:8,requestMaxSeconds:5})).toThrow('Request spacing');expect(()=>normalizePacing({pageMinSeconds:1})).toThrow('Page pause');expect(()=>normalizePacing({groupMaxSeconds:NaN})).toThrow('Group pause');});
});
