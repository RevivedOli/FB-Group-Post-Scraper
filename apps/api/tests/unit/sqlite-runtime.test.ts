import {describe,expect,it} from 'vitest';
import {sqliteRuntimeUrl} from '../../src/db/sqlite-runtime.js';
describe('SQLite runtime connection policy',()=>{
 it('uses one connection and a bounded busy timeout, retaining other parameters',()=>{const url=sqliteRuntimeUrl('file:/tmp/example.sqlite?connection_limit=20&foo=bar');expect(url).toContain('connection_limit=1');expect(url).toContain('socket_timeout=15');expect(url).toContain('foo=bar');});
 it('does not alter non-SQLite connection URLs',()=>{expect(sqliteRuntimeUrl('postgresql://example/db')).toBe('postgresql://example/db');});
});
