import {describe,expect,it,vi} from 'vitest';
import {localControl} from '../../src/routes/local-control.js';
describe('local notification/control origin checks',()=>{
 it('rejects a third-party website origin',()=>{const status=vi.fn().mockReturnThis(),json=vi.fn(),next=vi.fn();localControl({get:()=> 'https://unrelated.example'} as never,{status,json} as never,next);expect(status).toHaveBeenCalledWith(403);expect(next).not.toHaveBeenCalled();});
 it('accepts the local UI and CLI requests',()=>{for(const origin of ['http://127.0.0.1:5182',undefined]){const next=vi.fn();localControl({get:()=>origin} as never,{} as never,next);expect(next).toHaveBeenCalled();}});
});
