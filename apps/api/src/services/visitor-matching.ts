import { createHash } from 'node:crypto';
export const visitorStatuses = ['not contacted', 'drafted', 'invited', 'visiting', 'declined', 'member already elsewhere', 'not suitable', 'joined'] as const;
export const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function contentHash(text: string) {
    return createHash('sha256').update(normalize(text.replace(/https?:\/\/\S+/gi, '').replace(/\bwww\.\S+/gi, ''))).digest('hex');
}
export function matchedTerms(text: string, keywords: string[]) {
    const normalized = ` ${normalize(text)} `;
    return keywords.filter(term => normalized.includes(` ${normalize(term)} `));
}
export function businessIdentity(text: string, postId: string) {
    const rawSites = text.match(/(?:https?:\/\/|www\.)[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>]*)?/gi) ?? [];
    let website: string | undefined;
    for (const raw of rawSites) {
        try {
            const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
            const host = url.hostname.replace(/^www\./, '').toLowerCase();
            if (!['facebook.com', 'fb.com', 'fb.me', 'instagram.com', 'tiktok.com', 'youtube.com', 'youtu.be', 'wa.me', 'linktr.ee', 'google.com', 'google.co.uk', 'bit.ly', 'tinyurl.com', 'gmail.com', 'outlook.com', 'linkedin.com', 'checkatrade.com', 'trustatrader.com', 'mybuilder.com', 'ratedpeople.com', 'yell.com', 'bark.com', 'nextdoor.co.uk', 'nextdoor.com', 'gumtree.com', 'goo.gl', 'g.co'].some(s => host === s || host.endsWith(`.${s}`))) {
                website = `https://${host}`;
                break;
            }
        }
        catch { }
    }
    const phoneText = text.replace(/(?:https?:\/\/|www\.)\S+/gi, '');
    const phone = phoneText.match(/(?<![\w/])(?:\+44\s?\(?0?\)?|0)(?:[ \t().-]*\d){9,10}(?!\d)/)?.[0];
    const normalizedPhone = phone?.replace(/\D/g, '').replace(/^44/, '0');
    const named = text.match(/(?:^|\n)\s*(?:company|business(?: name)?)\s*:\s*([^\n]{3,100})/i)?.[1]?.trim()
        ?? text.match(/\b([A-Z][\w&'’-]*(?:[ \t]+[A-Z][\w&'’-]*){0,5}[ \t]+(?:Limited|Ltd|LLP))\b/)?.[1];
    return { website, phone: normalizedPhone, name: named ?? (website ? new URL(website).hostname : 'Unidentified business — review source'), identityKey: website ? `domain:${new URL(website).hostname}` : normalizedPhone ? `phone:${normalizedPhone}` : `post:${postId}`, needsReview: !named };
}
const towns = ['ascot', 'sunninghill', 'sunningdale', 'winkfield', 'bracknell', 'binfield', 'warfield', 'windsor', 'eton', 'datchet', 'egham', 'englefield green', 'virginia water', 'camberley', 'bagshot', 'lightwater', 'crowthorne', 'sandhurst', 'maidenhead', 'burnham', 'cippenham', 'chobham'];
export function geography(text: string) { const found = matchedTerms(text, towns); const edge = matchedTerms(text, ['wokingham', 'reading', 'uxbridge', 'aldershot']); if (edge.length)
    return `Area review / deprioritise: ${edge.join(', ')}; confirm service to Ascot${found.length ? `; also mentions ${found.join(', ')}` : ''}`; return found.length ? `Mentioned: ${found.join(', ')}; service area needs review` : 'Service area unverified'; }
export function exclusionMatch<T extends {
    id: string;
    name: string;
    company: string;
}>(text: string, exclusions: T[]) {
    const normalized = ` ${normalize(text)} `;
    return exclusions.filter(e => [e.name, e.company].some(s => s && normalize(s).length >= 5 && normalized.includes(` ${normalize(s)} `)));
}
