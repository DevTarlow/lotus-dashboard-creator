/**
 * Live news from keyless, CORS-enabled providers.
 *
 * Every source below was checked for three things: no API key, no signup, and an
 * `access-control-allow-origin` header that permits a browser request from any
 * origin. That combination is rare in news, so the topic list in
 * `@/lib/mock/news` matches this file exactly — each topic has a live provider
 * and a labelled offline fallback.
 *
 * | Topic      | Provider         | Endpoint                        |
 * | ---------- | ---------------- | ------------------------------- |
 * | technology | Hacker News      | hn.algolia.com (front page)     |
 * | product    | DEV Community    | dev.to/api (top of the week)    |
 * | science    | Spaceflight News | spaceflightnewsapi.net          |
 * | world      | Wikipedia        | Portal:Current events (CC BY-SA)|
 *
 * What was rejected, and why, so nobody retries it: Reddit's `.json` endpoints
 * answer 403 to browsers; Lobsters sends no CORS header; the BBC, Google News and
 * most newspaper RSS feeds send no CORS header either (they need a proxy); the
 * free CORS proxies are uninteractive — `corsproxy.io` now rejects keyless calls
 * with 401, AllOrigins and codetabs time out or 522; CoinGecko's `/news` is
 * PRO-only; the old public CoinStats news endpoint is gone; GDELT is keyless but
 * throttles to one request every five seconds; and NewsAPI's free tier only
 * answers `localhost` origins, so it breaks the moment the dashboard is hosted.
 *
 * Everything here is pure apart from the `load` functions, which accept an
 * injected fetch so the unit suite never touches the network. Parsers take
 * untrusted JSON and return the same `NewsArticle` shape the simulated provider
 * produces, so the widget does not care where its headlines came from.
 */
import type { NewsArticle, NewsTopic } from '@/lib/mock/news';
import { isRecord } from '@/lib/utils';

/** Hacker News front page via Algolia — keyless, CORS. */
export const HN_SEARCH_API = 'https://hn.algolia.com/api/v1/search';

/** DEV Community articles — keyless, CORS. */
export const DEV_API = 'https://dev.to/api/articles';

/** Spaceflight News — keyless, CORS, space and science desks. */
export const SPACEFLIGHT_API = 'https://api.spaceflightnewsapi.net/v4/articles/';

/** MediaWiki action API — keyless, CORS via `origin=*`. */
export const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';

/**
 * How long live headlines are trusted before refetching.
 *
 * Each provider is a free, unmetered public service, so a quarter-hour window
 * keeps the panel current without hammering them; the refresh button bypasses it.
 */
export const NEWS_REFRESH_MS = 15 * 60 * 1000;

/** Thrown when no provider for a topic answered, so the widget can fall back. */
export class NewsError extends Error {
  /** The topic that failed, when the failure belongs to a single one. */
  readonly topic?: NewsTopic | 'all';

  constructor(message: string, topic?: NewsTopic | 'all') {
    super(message);
    this.name = 'NewsError';
    this.topic = topic;
  }
}

/** Structural fetch type, so tests can inject a stub without casting. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface NewsProvider {
  /** Stable id, used in tests. */
  readonly id: string;
  /** Short name shown in the widget footer. */
  readonly label: string;
  readonly topic: NewsTopic;
  /** Fetch and normalise one page of articles. */
  load(
    limit: number,
    fetchImpl: FetchLike,
    signal: AbortSignal | undefined,
    now: number,
  ): Promise<NewsArticle[]>;
}

export interface NewsResult {
  /** Newest first, capped at the requested limit, ids unique. */
  articles: NewsArticle[];
  /** Labels of the providers that answered. */
  providers: string[];
  /** Labels of the providers that did not — the list is still usable. */
  failed: string[];
}

export interface FetchNewsOptions {
  topic?: NewsTopic | 'all';
  limit?: number;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  /** Reference clock; defaults to `Date.now()`. */
  now?: number;
}

/* ------------------------------------------------------------------ helpers */

function record(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Non-empty trimmed string, or `undefined`. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Finite number, or `undefined`. */
function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Parse an ISO timestamp from an untrusted payload. */
function moment(value: unknown): number | undefined {
  const raw = text(value);
  if (raw === undefined) return undefined;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Newest first. */
function byRecency(a: NewsArticle, b: NewsArticle): number {
  return b.publishedAt - a.publishedAt;
}

/** Longest summary kept from any one provider. */
const SUMMARY_MAX = 320;

/**
 * Flatten a provider summary into one tidy line.
 *
 * Spaceflight's `summary` is scraped from RSS and can arrive with a site's whole
 * navigation in it, so every summary is collapsed and capped rather than trusted
 * to be prose. Truncation is marked, never silent.
 */
function trimSummary(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  if (text === '') return undefined;
  if (text.length <= SUMMARY_MAX) return text;
  const cut = text.slice(0, SUMMARY_MAX);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > SUMMARY_MAX / 2 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

async function getJson(url: string, fetchImpl: FetchLike, signal?: AbortSignal): Promise<unknown> {
  const response = await fetchImpl(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new NewsError(`Request failed with HTTP ${response.status}.`);
  return response.json() as Promise<unknown>;
}

/* ------------------------------------------------------- Hacker News (tech) */

/**
 * Algolia's front-page payload.
 *
 * `story_text` is HTML and is deliberately ignored: the point of this row is the
 * headline and the submission's own numbers, not a scraped excerpt.
 */
export function parseHackerNews(payload: unknown, options: { limit: number; now: number }): NewsArticle[] {
  return list(record(payload)?.['hits'])
    .flatMap((hit) => {
      const entry = record(hit);
      if (!entry) return [];
      const id = text(entry['objectID']);
      const title = text(entry['title']);
      if (id === undefined || title === undefined) return [];
      const createdAt = count(entry['created_at_i']);
      const points = count(entry['points']);
      const comments = count(entry['num_comments']);
      const author = text(entry['author']);
      const summary = [
        points === undefined ? null : `${points} points`,
        comments === undefined ? null : `${comments} comments`,
        author === undefined ? null : `submitted by ${author}`,
      ]
        .filter((part): part is string => part !== null)
        .join(' · ');
      return [
        {
          id: `hn-${id}`,
          title,
          topic: 'technology' as const,
          source: 'Hacker News',
          summary: trimSummary(summary),
          publishedAt: (createdAt ?? options.now / 1000) * 1000,
          url: text(entry['url']) ?? `https://news.ycombinator.com/item?id=${id}`,
        },
      ];
    })
    .slice(0, options.limit);
}

const hackerNews: NewsProvider = {
  id: 'hacker-news',
  label: 'Hacker News',
  topic: 'technology',
  async load(limit, fetchImpl, signal, now) {
    const url = `${HN_SEARCH_API}?tags=front_page&hitsPerPage=${Math.max(1, limit)}`;
    return parseHackerNews(await getJson(url, fetchImpl, signal), { limit, now });
  },
};

/* --------------------------------------------------------- DEV (product) */

/** DEV Community's `/api/articles` payload. */
export function parseDevArticles(payload: unknown, options: { limit: number; now: number }): NewsArticle[] {
  return list(payload)
    .flatMap((item) => {
      const entry = record(item);
      if (!entry) return [];
      const id = count(entry['id']);
      const title = text(entry['title']);
      if (id === undefined || title === undefined) return [];
      return [
        {
          id: `devto-${id}`,
          title,
          topic: 'product' as const,
          source: text(record(entry['user'])?.['name']) ?? 'DEV Community',
          summary: trimSummary(text(entry['description'])),
          publishedAt: moment(entry['published_at']) ?? options.now,
          readingMinutes: count(entry['reading_time_minutes']),
          url: text(entry['url']),
        },
      ];
    })
    .slice(0, options.limit);
}

const devCommunity: NewsProvider = {
  id: 'dev-community',
  label: 'DEV Community',
  topic: 'product',
  async load(limit, fetchImpl, signal, now) {
    // `top=7` keeps the week's best work in the panel instead of whatever was
    // posted most recently; recency is still reported per row.
    const url = `${DEV_API}?per_page=${Math.max(1, limit)}&top=7`;
    return parseDevArticles(await getJson(url, fetchImpl, signal), { limit, now });
  },
};

/* ------------------------------------------------ Spaceflight News (science) */

/** Spaceflight News' paginated `{ results: [...] }` payload. */
export function parseSpaceflightArticles(
  payload: unknown,
  options: { limit: number; now: number },
): NewsArticle[] {
  return list(record(payload)?.['results'])
    .flatMap((item) => {
      const entry = record(item);
      if (!entry) return [];
      const id = count(entry['id']);
      const title = text(entry['title']);
      if (id === undefined || title === undefined) return [];
      return [
        {
          id: `spn-${id}`,
          title,
          topic: 'science' as const,
          source: text(entry['news_site']) ?? 'Spaceflight News',
          summary: trimSummary(text(entry['summary'])),
          publishedAt: moment(entry['published_at']) ?? options.now,
          url: text(entry['url']),
        },
      ];
    })
    .slice(0, options.limit);
}

const spaceflightNews: NewsProvider = {
  id: 'spaceflight-news',
  label: 'Spaceflight News',
  topic: 'science',
  async load(limit, fetchImpl, signal, now) {
    return parseSpaceflightArticles(await getJson(`${SPACEFLIGHT_API}?limit=${Math.max(1, limit)}`, fetchImpl, signal), {
      limit,
      now,
    });
  },
};

/* ----------------------------------------- Wikipedia current events (world) */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** `Portal:Current events/2026 October 9` — the page a UTC day's stories live on. */
export function currentEventsPage(day: Date): string {
  return `Portal:Current events/${day.getUTCFullYear()} ${MONTHS[day.getUTCMonth()]} ${day.getUTCDate()}`;
}

/** Readable URL for a current-events page, used when an item cites no source. */
export function currentEventsUrl(day: Date): string {
  return `https://en.wikipedia.org/wiki/${currentEventsPage(day).replace(/ /g, '_')}`;
}

/** Request URL for one day's current-events wikitext. */
export function currentEventsRequest(day: Date): string {
  const params = new URLSearchParams({
    action: 'parse',
    page: currentEventsPage(day),
    prop: 'wikitext',
    format: 'json',
    formatversion: '2',
    origin: '*',
  });
  return `${WIKIPEDIA_API}?${params.toString()}`;
}

/** Accept both `formatversion=2` and the older `{ "*": … }` wikitext wrapper. */
export function readWikitext(payload: unknown): string | undefined {
  const wikitext = record(record(payload)?.['parse'])?.['wikitext'];
  if (typeof wikitext === 'string') return wikitext;
  return text(record(wikitext)?.['*']);
}

interface Citation {
  url: string;
  label: string;
}

/**
 * Strip the markup a current-events bullet can carry, and pull out its citations.
 *
 * Current-events items are wikitext: `[[Page|Label]]` links, `'''Section'''`
 * headings, `<ref>` tags, and `[https://… (Publisher)]` citations at the end.
 * The reader wants the sentence, the publisher and a link — so this returns all
 * three rather than regex-mangled prose.
 */
export function cleanCurrentEvent(source: string): { text: string; citations: Citation[] } {
  const citations: Citation[] = [];
  let text = source
    // Comments and refs carry no reader-visible content.
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<ref[^>]*\/>/g, ' ')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    // Templates ({{cite web|…}}) are never prose.
    .replace(/\{\{[^{}]*\}\}/g, ' ')
    .replace(/\{\{[^{}]*\}\}/g, ' ');

  text = text.replace(/\[(https?:\/\/[^\s\]]+)\s*([^\]]*)\]/g, (_match, url: string, label: string) => {
    citations.push({ url, label: label.trim().replace(/^\(|\)$/g, '').replace(/'+/g, '').trim() });
    return ' ';
  });

  text = text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&mdash;/g, '—')
    .replace(/\s+/g, ' ')
    .trim();

  return { text, citations };
}

/** One current-events day, newest first per the page's own ordering. */
export function parseCurrentEvents(
  wikitext: string,
  options: { day: Date; limit: number },
): NewsArticle[] {
  const pageUrl = currentEventsUrl(options.day);
  // The portal has one page per UTC day, so every story on it is dated to the
  // day it covers; the source publishes no finer time than that.
  const publishedAt = Date.UTC(
    options.day.getUTCFullYear(),
    options.day.getUTCMonth(),
    options.day.getUTCDate(),
  );
  const dayKey = options.day.toISOString().slice(0, 10);
  const articles: NewsArticle[] = [];

  let headline: { text: string; citations: Citation[] } | null = null;
  let details: { depth: number; text: string }[] = [];
  // A bare label (`*[[Earthquake]]`) usually carries its citations on the
  // sub-bullets, so the story collects them from every line it owns.
  let citations: Citation[] = [];

  const flush = () => {
    if (headline === null || headline.text === '') return;
    // Wiki convention nests a sub-story under its own label:
    //   *[[Hurricane season]]
    //   **[[Hurricane Isaias]]
    //   ***Isaias strengthens into a category 3 hurricane.
    // Only the deepest lines are prose; folding the labels in too would read
    // "Hurricane Isaias Isaias strengthens…".
    const deepest = details.reduce((max, detail) => Math.max(max, detail.depth), 0);
    const summary = details
      .filter((detail) => detail.depth === deepest)
      .map((detail) => detail.text)
      .join(' ');
    articles.push({
      id: `wiki-${dayKey}-${articles.length}`,
      title: headline.text,
      topic: 'world',
      source: citations[0]?.label || 'Wikipedia',
      // A bare label is completed by its sub-bullets; a full sentence is its own
      // story and needs no expansion.
      summary: trimSummary(summary),
      publishedAt,
      url: citations[0]?.url ?? pageUrl,
    });
    headline = null;
    details = [];
    citations = [];
  };

  for (const raw of wikitext.split('\n')) {
    const line = raw.trim();
    const bullet = /^(\*+)\s*(.*)$/.exec(line);
    if (bullet === null) continue;
    const cleaned = cleanCurrentEvent(bullet[2]);
    if (cleaned.text === '') continue;
    const depth = bullet[1].length;
    if (depth === 1) {
      flush();
      headline = cleaned;
    } else if (headline !== null) {
      details.push({ depth, text: cleaned.text });
    }
    citations.push(...cleaned.citations);
  }
  flush();

  return articles.slice(0, options.limit);
}

const wikipedia: NewsProvider = {
  id: 'wikipedia',
  label: 'Wikipedia',
  topic: 'world',
  async load(limit, fetchImpl, signal, now) {
    const read = async (day: Date): Promise<NewsArticle[]> => {
      const payload = await getJson(currentEventsRequest(day), fetchImpl, signal);
      const wikitext = readWikitext(payload);
      return wikitext === undefined ? [] : parseCurrentEvents(wikitext, { day, limit });
    };

    const today = new Date(now);
    const articles = await read(today);
    // Early in the UTC day today's page is often still nearly empty, so top it up
    // from yesterday rather than showing a one-line world feed.
    if (articles.length < limit) {
      const yesterday = new Date(now - 24 * 60 * 60 * 1000);
      articles.push(...(await read(yesterday)));
    }

    const seen = new Set<string>();
    const unique: NewsArticle[] = [];
    for (const article of articles) {
      if (seen.has(article.title)) continue;
      seen.add(article.title);
      unique.push(article);
    }
    return unique.sort(byRecency).slice(0, limit);
  },
};

export const NEWS_PROVIDERS: readonly NewsProvider[] = [
  hackerNews,
  devCommunity,
  spaceflightNews,
  wikipedia,
];

/** Providers covering a topic, in a stable order. */
export function providersFor(topic: NewsTopic | 'all'): NewsProvider[] {
  return NEWS_PROVIDERS.filter((provider) => topic === 'all' || provider.topic === topic);
}

/**
 * Round-robin merge, so one chatty provider cannot fill the panel.
 *
 * A global sort by timestamp would be dominated by whichever source publishes
 * most often — Wikipedia's day-level stamps would never survive the cut. Taking
 * one row per provider in turn keeps every topic visible while each provider's
 * own entries stay newest first.
 */
function interleave(groups: readonly NewsArticle[][], limit: number): NewsArticle[] {
  const queues = groups.map((group) => [...group].sort(byRecency));
  const merged: NewsArticle[] = [];
  for (let depth = 0; merged.length < limit; depth += 1) {
    const before = merged.length;
    for (const queue of queues) {
      const article = queue[depth];
      if (article !== undefined && merged.length < limit) merged.push(article);
    }
    if (merged.length === before) break;
  }
  return merged;
}

/**
 * Headlines for one topic, or for every topic at once.
 *
 * Partial failure is not an error: whatever answered is returned, and the labels
 * that did not are reported so the footer can say so. Only a total failure
 * throws, which is the signal for the widget to fall back to the labelled
 * simulated feed.
 */
export async function fetchNews(options: FetchNewsOptions = {}): Promise<NewsResult> {
  const { topic = 'all', limit = 6, signal, fetchImpl = fetch, now = Date.now() } = options;
  const selected = providersFor(topic);
  if (selected.length === 0) throw new NewsError(`No live provider covers “${topic}”.`, topic);

  const settled = await Promise.allSettled(
    selected.map((provider) => provider.load(limit, fetchImpl, signal, now)),
  );

  // An unmounting widget aborts its request; that is not a provider outage.
  if (signal?.aborted === true) throw new NewsError('The news request was cancelled.', topic);

  const providers: string[] = [];
  const failed: string[] = [];
  const groups: NewsArticle[][] = [];
  settled.forEach((outcome, index) => {
    const provider = selected[index];
    if (outcome.status === 'fulfilled') {
      providers.push(provider.label);
      groups.push(outcome.value);
    } else {
      failed.push(provider.label);
    }
  });

  if (groups.length === 0) {
    throw new NewsError(`No live news provider responded (${failed.join(', ')}).`, topic);
  }

  return {
    articles: topic === 'all' ? interleave(groups, limit) : [...groups[0]].sort(byRecency).slice(0, limit),
    providers,
    failed,
  };
}
