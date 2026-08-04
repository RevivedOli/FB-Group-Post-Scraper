import { describe, expect, it } from 'vitest';
import { normalizeFacebookGroupUrl } from '../../src/services/url-normalizer.js';
describe('normalizeFacebookGroupUrl',()=>{ it('normalizes group urls',()=>{ expect(normalizeFacebookGroupUrl('https://m.facebook.com/groups/MyGroup/?x=1')).toBe('https://www.facebook.com/groups/mygroup'); }); it('rejects non-facebook urls',()=>{ expect(()=>normalizeFacebookGroupUrl('https://example.com/groups/a')).toThrow(); }); });
