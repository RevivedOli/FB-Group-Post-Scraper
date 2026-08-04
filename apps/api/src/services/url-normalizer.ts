export function normalizeFacebookGroupUrl(input: string): string {
  const raw = input.trim();
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Invalid URL'); }
  if (!['facebook.com','www.facebook.com','m.facebook.com'].includes(url.hostname.toLowerCase())) throw new Error('URL must be a Facebook URL');
  const parts = url.pathname.split('/').filter(Boolean);
  const groupIndex = parts.findIndex(p => p.toLowerCase() === 'groups');
  if (groupIndex === -1 || !parts[groupIndex + 1]) throw new Error('URL must point to a Facebook group');
  const groupSlug = decodeURIComponent(parts[groupIndex + 1]).toLowerCase();
  return `https://www.facebook.com/groups/${encodeURIComponent(groupSlug)}`;
}
