/**
 * Simulated news / RSS feed.
 *
 * A rotating, deterministic feed built from a small pool of generic headlines.
 * It exists so the RSS widget is fully functional offline; the widget labels the
 * data as simulated and supports switching topic and page size.
 */
import { createSeededRandom, hashString } from '@/lib/utils';

export type NewsTopic = 'technology' | 'markets' | 'product' | 'science' | 'world';

export interface NewsArticle {
  id: string;
  title: string;
  topic: NewsTopic;
  source: string;
  summary: string;
  publishedAt: number;
  readingMinutes: number;
}

export const NEWS_TOPICS: readonly { id: NewsTopic; label: string }[] = [
  { id: 'technology', label: 'Technology' },
  { id: 'markets', label: 'Markets' },
  { id: 'product', label: 'Product' },
  { id: 'science', label: 'Science' },
  { id: 'world', label: 'World' },
];

const SOURCES: Record<NewsTopic, readonly string[]> = {
  technology: ['The Circuit', 'Stack Weekly', 'DevSignal'],
  markets: ['Market Wire', 'The Ledger', 'Opening Bell'],
  product: ['Product Notes', 'Build Log', 'Ship It'],
  science: ['Orbital', 'Lab Notes', 'Field Report'],
  world: ['Atlas Daily', 'The Meridian', 'Northwind'],
};

interface Headline {
  topic: NewsTopic;
  title: string;
  summary: string;
}

const HEADLINES: readonly Headline[] = [
  {
    topic: 'technology',
    title: 'Type-safe plugin architectures are quietly becoming the default',
    summary:
      'Registry-based widget systems keep bundles small while letting teams ship features independently — and TypeScript does the guarding.',
  },
  {
    topic: 'technology',
    title: 'Why local-first apps are winning back power users',
    summary:
      'Instant interactions, offline tolerance and data ownership are proving to be features, not nostalgia.',
  },
  {
    topic: 'technology',
    title: 'The quiet return of the dashboard',
    summary:
      'After a decade of notification streams, teams are rebuilding focused, glanceable workspaces they actually arrange themselves.',
  },
  {
    topic: 'technology',
    title: 'CSS container queries land everywhere, layouts get simpler',
    summary: 'Component-level responsiveness removes a whole category of JavaScript measurement code.',
  },
  {
    topic: 'technology',
    title: 'Bundle budgets: the metric that finally stuck',
    summary: 'Teams report shipping less code after making payload size a reviewable, visible number.',
  },
  {
    topic: 'markets',
    title: 'Index futures drift higher as volatility cools',
    summary: 'Traders point to a calmer rate outlook and steady earnings revisions.',
  },
  {
    topic: 'markets',
    title: 'Digital assets rally as on-chain activity picks up',
    summary: 'Spot volumes rose for a third session while funding rates stayed neutral.',
  },
  {
    topic: 'markets',
    title: 'Earnings season: what to watch this week',
    summary: 'Guidance matters more than the headline number for four of the largest reporters.',
  },
  {
    topic: 'markets',
    title: 'Energy leads sector rotation as crude steadies',
    summary: 'Defensive names lagged while cyclicals caught a bid into the close.',
  },
  {
    topic: 'markets',
    title: 'Bond yields ease after a softer inflation print',
    summary: 'Rate-sensitive sectors outperformed on the day.',
  },
  {
    topic: 'product',
    title: 'Shipping a settings modal that scales to twenty widgets',
    summary: 'A schema-driven form removed hundreds of lines of hand-written UI code.',
  },
  {
    topic: 'product',
    title: 'Designing for drag and drop without breaking accessibility',
    summary: 'Keyboard alternatives and clear focus states make rearrangement usable for everyone.',
  },
  {
    topic: 'product',
    title: 'Undo is the feature users never ask for and always miss',
    summary: 'Coalescing rapid edits into a single history step keeps the mental model simple.',
  },
  {
    topic: 'product',
    title: 'Empty states are onboarding',
    summary: 'The first screen after a reset decides whether a workspace feels alive or abandoned.',
  },
  {
    topic: 'science',
    title: 'Observatory logs a new class of fast radio burst',
    summary: 'The signal repeated on a 16 day cycle, offering a rare handle on its origin.',
  },
  {
    topic: 'science',
    title: 'Lab-grown coral shows unexpected heat tolerance',
    summary: 'Selective breeding trials suggest reefs may adapt faster than models assumed.',
  },
  {
    topic: 'science',
    title: 'Battery chemistry milestone: 900 cycles with minimal fade',
    summary: 'A new electrolyte mix keeps capacity above 92 percent after two years of equivalent use.',
  },
  {
    topic: 'world',
    title: 'Coastal cities coordinate on a shared flood plan',
    summary: 'Twelve municipalities agreed on common thresholds and data sharing.',
  },
  {
    topic: 'world',
    title: 'Rail network adds overnight routes across the corridor',
    summary: 'Capacity rises as business travel shifts back to sleeper services.',
  },
  {
    topic: 'world',
    title: 'Record harvest eases regional food prices',
    summary: 'Better storage logistics kept more of the crop out of post-harvest loss.',
  },
];

/** One hour windows — the feed rotates as the day moves on. */
export const NEWS_BUCKET_MS = 60 * 60 * 1000;

export interface NewsFeedOptions {
  topic?: NewsTopic | 'all';
  limit?: number;
  now?: number;
  /** Bump to reshuffle within the same window (used by the refresh button). */
  seedOffset?: number;
}

/** Build a feed of simulated articles, newest first. */
export function getNewsFeed(options: NewsFeedOptions = {}): NewsArticle[] {
  const { topic = 'all', limit = 6, now = Date.now(), seedOffset = 0 } = options;
  const bucket = Math.floor(now / NEWS_BUCKET_MS);
  const random = createSeededRandom(hashString(`feed:${topic}:${bucket}:${seedOffset}`));

  const pool = HEADLINES.filter((headline) => topic === 'all' || headline.topic === topic);
  const shuffled = [...pool]
    .map((headline) => ({ headline, order: random() }))
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.headline);

  const bucketStart = bucket * NEWS_BUCKET_MS;

  return shuffled.slice(0, Math.max(1, Math.min(limit, shuffled.length))).map((headline, index) => {
    const sources = SOURCES[headline.topic];
    const sourceRandom = createSeededRandom(hashString(`${headline.title}:${bucket}`));
    const minutesAgo = Math.round(index * 34 + sourceRandom() * 26 + 4);
    return {
      id: `${bucket}-${index}-${hashString(headline.title).toString(36)}`,
      title: headline.title,
      topic: headline.topic,
      source: sources[Math.floor(sourceRandom() * sources.length)],
      summary: headline.summary,
      publishedAt: bucketStart - minutesAgo * 60 * 1000,
      readingMinutes: 2 + Math.floor(sourceRandom() * 5),
    };
  });
}

/** Human readable topic label. */
export function topicLabel(topic: NewsTopic | 'all'): string {
  if (topic === 'all') return 'All topics';
  return NEWS_TOPICS.find((entry) => entry.id === topic)?.label ?? topic;
}
