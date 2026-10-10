/**
 * URL helpers for the quick links widget.
 */

/** Add a scheme when the user typed a bare domain, then validate. */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') return '';
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (!url.hostname.includes('.')) return '';
    return url.toString();
  } catch {
    return '';
  }
}

/** `true` when the value can be turned into a valid http(s) URL. */
export function isValidUrl(input: string): boolean {
  return normalizeUrl(input) !== '';
}

/** Host name without the `www.` prefix, for display. */
export function displayHost(input: string): string {
  const url = normalizeUrl(input);
  if (url === '') return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Favicon endpoint (works offline by falling back to an initial chip). */
export function faviconUrl(input: string, size = 64): string {
  const host = displayHost(input);
  if (host === '') return '';
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;
}

/** Derive a readable label from a URL, e.g. `news.ycombinator.com` → `Hacker News`-ish fallback. */
export function guessLabel(input: string): string {
  const host = displayHost(input);
  if (host === '') return 'New link';
  const parts = host.split('.');
  const meaningful = parts.length > 2 ? parts[parts.length - 2] : parts[0];
  return meaningful.charAt(0).toUpperCase() + meaningful.slice(1);
}

/** Up to two initials for the favicon fallback chip. */
export function initialsFor(label: string, url: string): string {
  const trimmed = label.trim();
  // Without a label, prefer the domain's own name over "github.com" → "GC".
  const source = trimmed !== '' ? trimmed : (displayHost(url).split('.')[0] ?? '');
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}
