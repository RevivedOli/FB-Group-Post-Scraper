import { describe, expect, it } from 'vitest';
import { businessIdentity, contentHash, exclusionMatch, geography, matchedTerms } from '../../src/services/visitor-matching.js';
import { visitorSeed } from '../../src/services/visitor-seed.js';
describe('visitor trial evidence', () => {
    it('seeds ten seats, preserves drafted invites and flags lettings', () => {
        expect(visitorSeed.categories).toHaveLength(10);
        expect(visitorSeed.categories.find(c => c.name.startsWith('Letting'))?.reviewFlag).toContain('overlap');
        expect(visitorSeed.exclusions.find(e => e.id === 'outreach-V1')?.status).toBe('drafted');
        expect(visitorSeed.exclusions.filter(e => e.id.startsWith('member-'))).toHaveLength(32);
    });
    it('groups matching business domains across posting accounts, not social or shortener domains', () => {
        expect(businessIdentity('Commercial cleaning https://www.example.co.uk/offer', 'p1').identityKey).toBe(businessIdentity('Office cleaning https://example.co.uk', 'p2').identityKey);
        expect(businessIdentity('https://facebook.com/someone', 'p1').identityKey).toBe('post:p1');
        expect(businessIdentity('https://bit.ly/abc', 'p2').identityKey).toBe('post:p2');
        expect(businessIdentity('https://checkatrade.com/trades/someone', 'p2').identityKey).toBe('post:p2');
        expect(businessIdentity('https://facebook.com/groups/123/posts/100737627450', 'p3').identityKey).toBe('post:p3');
    });
    it('matches equivalent UK phone formats but leaves ambiguous businesses separate', () => {
        expect(businessIdentity('Call +44 7700 900123', 'p1').identityKey).toBe(businessIdentity('Call 07700 900123', 'p2').identityKey);
        expect(businessIdentity('Carpenter Fred', 'p1').identityKey).not.toBe(businessIdentity('Carpenter Fred', 'p2').identityKey);
    });
    it('deduplicates copied advert content independently of links and group post IDs', () => {
        expect(contentHash('Commercial cleaning! https://example.com/a')).toBe(contentHash('Commercial cleaning https://example.com/b'));
        expect(contentHash('Commercial cleaning offices')).not.toBe(contentHash('Commercial cleaning shops'));
    });
    it('extracts an explicitly published legal company name without inferring an owner',()=>{expect(businessIdentity('Super Removals Limited is a reliable company. Call 0203 370 6727','p').name).toBe('Super Removals Limited');});
    it('uses phrase boundaries and labels geography as evidence rather than verified service area', () => {
        expect(matchedTerms('scaffolding in Ascot', ['scaffold', 'scaffolding'])).toEqual(['scaffolding']);
        expect(geography('Ascot cleaning')).toContain('needs review');
        expect(geography('London cleaning')).toBe('Service area unverified');
    });
    it('exclusions match names and companies without hiding source evidence', () => {
        expect(exclusionMatch('Bergamot HR Consulting offer', visitorSeed.exclusions).map(e => e.id)).toContain('outreach-V1');
        expect(exclusionMatch('A novel business', visitorSeed.exclusions)).toEqual([]);
    });
});
