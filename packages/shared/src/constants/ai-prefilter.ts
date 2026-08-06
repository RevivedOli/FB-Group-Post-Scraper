export const DEFAULT_AI_PREFILTER_PHRASES = [
  'looking for',
  'look for',
  'can anyone',
  'does anyone',
  'anyone know',
  'anyone recommend',
  'recommend',
  'recommendation',
  'any recommendations',
  'any suggestion',
  'suggestions',
  'need a',
  'need an',
  'needed',
  'in need of',
  'seeking',
  'wanted',
  'who can',
  'who do you recommend',
  'know a good',
  'know anyone',
  'help with',
  'looking after',
  'any good',
  'dm me',
  'please recommend',
].join('\n');

export function parseAiPrefilterPhrases(value: string | null | undefined): string[] {
  return String(value ?? '')
    .split(/[\n,]+/)
    .map((phrase) => phrase.trim().toLowerCase())
    .filter((phrase) => phrase.length >= 2);
}

export function matchesAiPrefilter(
  text: string | null | undefined,
  phrases: string[] | string,
): { matched: boolean; matchedPhrase?: string } {
  const haystack = String(text ?? '').toLowerCase();
  if (!haystack.trim()) return { matched: false };
  const list = Array.isArray(phrases) ? phrases : parseAiPrefilterPhrases(phrases);
  for (const phrase of list) {
    if (haystack.includes(phrase)) return { matched: true, matchedPhrase: phrase };
  }
  return { matched: false };
}
