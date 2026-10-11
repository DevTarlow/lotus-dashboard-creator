/**
 * "On this day" from the Wikimedia feeds.
 *
 * Keyless and CORS-enabled (`access-control-allow-origin: *`) from
 * `api.wikimedia.org`, the same family the news widget already reads. Four desks
 * are available — a curated selection, an events list, and births and deaths —
 * and each answers with items carrying a year, a sentence, and the article(s)
 * they came from.
 *
 * Two details the payload forces on us:
 * - `displaytitle` is **HTML** (`<span class="mw-page-title-main">…`), so the
 *   plain `title` (or a tag-stripped display title) is what gets shown;
 * - thumbnails are optional, and a missing one must leave the row shorter rather
 *   than leaving a broken image.
 *
 * Wikipedia content is CC BY-SA, so the widget shows the attribution the licence
 * requires.
 */
import { HttpError, requestJson } from '@/lib/http';

const ONTHISDAY_ENDPOINT = 'https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday';

/** A day's history does not change during a session. */
export const ONTHISDAY_TTL_MS = 60 * 60 * 1000;

export type OnThisDayKind = 'selected' | 'events' | 'births' | 'deaths';

export const ONTHISDAY_KINDS: readonly { id: OnThisDayKind; label: string }[] = [
  { id: 'selected', label: 'Curated highlights' },
  { id: 'events', label: 'Events' },
  { id: 'births', label: 'Births' },
  { id: 'deaths', label: 'Deaths' },
];

export interface OnThisDayItem {
  /** Stable key: the year plus the page title. */
  id: string;
  year: number | null;
  /** Plain-text sentence, tags removed. */
  text: string;
  /** Article this came from, when it has one. */
  page: {
    title: string;
    /** Human-readable title, `<span>` markup removed. */
    label: string;
    url: string;
    description: string;
    thumbnail: string | null;
  } | null;
}

/** Tags are stripped, and the HTML entities the feed uses are decoded. */
export function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ContentUrls {
  desktop?: { page?: unknown };
  mobile?: { page?: unknown };
}

function readPage(value: unknown): OnThisDayItem['page'] {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const title = typeof record.title === 'string' ? record.title : '';
  if (title === '') return null;

  const display = typeof record.displaytitle === 'string' ? stripHtml(record.displaytitle) : '';
  const urls = record.content_urls as ContentUrls | undefined;
  const url = typeof urls?.desktop?.page === 'string' ? urls.desktop.page : typeof urls?.mobile?.page === 'string' ? urls.mobile.page : '';
  const thumbnail = record.thumbnail as { source?: unknown } | undefined;

  return {
    title,
    label: display !== '' ? display : title.replace(/_/g, ' '),
    url,
    description: typeof record.description === 'string' ? record.description : '',
    thumbnail: typeof thumbnail?.source === 'string' ? thumbnail.source : null,
  };
}

/** Map one feed payload (any of the four desks) into rows. */
export function mapOnThisDay(payload: unknown, kind: OnThisDayKind): OnThisDayItem[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const bucket = (payload as Record<string, unknown>)[kind];
  if (!Array.isArray(bucket)) return [];

  const items: OnThisDayItem[] = [];
  for (const entry of bucket) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const text = typeof record.text === 'string' ? stripHtml(record.text) : '';
    if (text === '') continue;
    const year = typeof record.year === 'number' && Number.isFinite(record.year) ? record.year : null;
    const pages = Array.isArray(record.pages) ? (record.pages as unknown[]) : [];
    const page = readPage(pages[0]);
    items.push({ id: `${year ?? 'x'}:${page?.title ?? text.slice(0, 24)}`, year, text, page });
  }
  return items;
}

/** Fetch one day of history. `date` defaults to today. */
export async function fetchOnThisDay(
  kind: OnThisDayKind,
  date: Date,
  signal: AbortSignal,
): Promise<{ items: OnThisDayItem[]; fromCache: boolean }> {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const url = `${ONTHISDAY_ENDPOINT}/${kind}/${month}/${day}`;
  const key = `wikimedia:onthisday:${kind}:${month}/${day}`;

  const response = await requestJson<unknown>(key, url, { ttlMs: ONTHISDAY_TTL_MS, signal });
  const items = mapOnThisDay(response.data, kind);
  if (items.length === 0) {
    // A valid day always has something; an empty array means we misread it.
    throw new HttpError('Wikimedia sent a payload that did not contain any entries.', 'parse');
  }
  return { items, fromCache: response.fromCache };
}

/** Direction an item's year sits in, relative to now — used for the label. */
export function yearsAgo(year: number | null, now: Date): number | null {
  if (year === null) return null;
  return now.getFullYear() - year;
}

/** "142 years ago" / "in 3 years" / null when the year is unknown. */
export function agoLabel(year: number | null, now: Date): string | null {
  const delta = yearsAgo(year, now);
  if (delta === null) return null;
  if (delta === 0) return 'this year';
  if (delta === 1) return '1 year ago';
  if (delta === -1) return 'next year';
  return delta > 0 ? `${delta} years ago` : `in ${Math.abs(delta)} years`;
}
