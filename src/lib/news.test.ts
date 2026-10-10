import { describe, expect, it, vi } from 'vitest';
import {
  cleanCurrentEvent,
  currentEventsPage,
  currentEventsRequest,
  DEV_API,
  fetchNews,
  NewsError,
  NEWS_PROVIDERS,
  parseCurrentEvents,
  parseDevArticles,
  parseHackerNews,
  parseSpaceflightArticles,
  providersFor,
  readWikitext,
  type FetchLike,
} from '@/lib/news';
import { isNewsTopic, NEWS_TOPICS } from '@/lib/mock/news';

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);

/** Routed stub: matches a request URL substring to a JSON body. */
function stubFetch(routes: Record<string, unknown>, broken: readonly string[] = []): FetchLike {
  return async (input) => {
    for (const fragment of broken) {
      if (input.includes(fragment)) return new Response('upstream error', { status: 500 });
    }
    for (const [fragment, body] of Object.entries(routes)) {
      if (input.includes(fragment)) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response('unrouted', { status: 404 });
  };
}

const HN_BODY = {
  hits: [
    {
      objectID: '50019911',
      title: 'Cloudflare acquires Deno',
      url: 'https://deno.com/blog/cloudflare',
      points: 218,
      num_comments: 94,
      author: 'ilreb',
      created_at_i: Math.floor(NOW / 1000) - 600,
    },
    {
      objectID: '50019000',
      title: 'Ask HN: how do you test network code?',
      points: 12,
      num_comments: 3,
      author: 'ada',
      created_at_i: Math.floor(NOW / 1000) - 3600,
    },
    // No title — must be skipped rather than rendered blank.
    { objectID: '50018000', points: 1, created_at_i: Math.floor(NOW / 1000) - 7200 },
  ],
};

const DEV_BODY = [
  {
    id: 4823945,
    title: 'Shipping a settings modal that scales',
    description: 'A schema-driven form removed hundreds of lines of UI code.',
    url: 'https://dev.to/someone/shipping-a-settings-modal-1fec',
    published_at: new Date(NOW - 7200_000).toISOString(),
    reading_time_minutes: 10,
    user: { name: 'Sam' },
  },
  { id: 'not-a-number', title: 'Broken row' },
];

const SPACEFLIGHT_BODY = {
  count: 2,
  results: [
    {
      id: 40339,
      title: 'APOD: Lunar Farside',
      summary: 'A daily image of the cosmos.',
      url: 'https://science.nasa.gov/image-article/apod-lunar-farside/',
      published_at: new Date(NOW - 1800_000).toISOString(),
      news_site: 'NASA',
    },
    { id: 40340, title: 'Cygnus released from station', published_at: 'not-a-date', news_site: 'NASASpaceflight' },
  ],
};

const WIKITEXT = `{{Current events|year=2026|month=10|day=9|top=yes}}
<!-- All news items below this line -->
'''Arts and culture'''
*[[Pope Leo XIV]] approves [[Catholic Church in the Philippines|Filipino]] [[Cardinal (Catholic Church)|cardinal]] [[Luis Antonio Tagle]]'s election. [https://www.reuters.com/world/tagle (Reuters)]<ref name="a">{{cite news|url=x}}</ref>
'''Disasters and accidents'''
*[[2026 Panama earthquake]]
**A magnitude 7.7 earthquake strikes [[Herrera Province]], [[Panama]]. [https://apnews.com/article/quake (AP)]
*[[2026 Atlantic hurricane season]]
**[[Hurricane Isaias]]
***Isaias strengthens into a category 3 hurricane. [https://apnews.com/article/isaias (AP)]`;

const WIKI_BODY = { parse: { title: 'Portal:Current events', wikitext: WIKITEXT } };

describe('news topic coverage', () => {
  it('gives every simulated topic a live provider', () => {
    for (const topic of NEWS_TOPICS) {
      expect(providersFor(topic.id).length, topic.id).toBeGreaterThan(0);
    }
  });

  it('assigns each provider exactly one topic', () => {
    const topics = NEWS_PROVIDERS.map((provider) => provider.topic);
    expect(new Set(topics).size).toBe(topics.length);
  });

  it('rejects topics an older export might still carry', () => {
    expect(isNewsTopic('world')).toBe(true);
    expect(isNewsTopic('markets')).toBe(false);
    expect(isNewsTopic(42)).toBe(false);
  });
});

describe('hacker news parser', () => {
  it('maps hits, composes the submission summary and caps the page size', () => {
    const articles = parseHackerNews(HN_BODY, { limit: 2, now: NOW });
    expect(articles).toHaveLength(2);
    expect(articles[0]).toMatchObject({
      id: 'hn-50019911',
      title: 'Cloudflare acquires Deno',
      topic: 'technology',
      source: 'Hacker News',
      url: 'https://deno.com/blog/cloudflare',
      summary: '218 points · 94 comments · submitted by ilreb',
    });
    expect(articles[0].publishedAt).toBe(Math.floor(NOW / 1000) * 1000 - 600_000);
    // Ask HN posts carry no external URL, so the thread is the link.
    expect(articles[1].url).toBe('https://news.ycombinator.com/item?id=50019000');
  });

  it('survives a payload that is not the expected shape', () => {
    expect(parseHackerNews(null, { limit: 5, now: NOW })).toEqual([]);
    expect(parseHackerNews({ hits: 'nope' }, { limit: 5, now: NOW })).toEqual([]);
    expect(parseHackerNews({ hits: [null, 7] }, { limit: 5, now: NOW })).toEqual([]);
  });
});

describe('dev.to parser', () => {
  it('maps articles, keeps the reported read time and attributes the author', () => {
    const articles = parseDevArticles(DEV_BODY, { limit: 5, now: NOW });
    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({
      id: 'devto-4823945',
      topic: 'product',
      source: 'Sam',
      readingMinutes: 10,
      url: 'https://dev.to/someone/shipping-a-settings-modal-1fec',
    });
  });

  it('falls back to the platform name when the author is missing', () => {
    const articles = parseDevArticles([{ id: 1, title: 'No author', published_at: 'nope' }], { limit: 5, now: NOW });
    expect(articles[0]).toMatchObject({ source: 'DEV Community', publishedAt: NOW, summary: undefined });
  });
});

describe('spaceflight news parser', () => {
  it('maps results and names the publishing desk', () => {
    const articles = parseSpaceflightArticles(SPACEFLIGHT_BODY, { limit: 5, now: NOW });
    expect(articles).toHaveLength(2);
    expect(articles[0]).toMatchObject({ id: 'spn-40339', topic: 'science', source: 'NASA' });
    // An unparseable date falls back to the caller's clock rather than NaN.
    expect(articles[1].publishedAt).toBe(NOW);
    expect(articles[1].readingMinutes).toBeUndefined();
  });

  it('collapses and caps the scraped summary the provider ships', () => {
    const scraped = `${'Archive   Submissions\n'.repeat(60)}Ends here.`;
    const [article] = parseSpaceflightArticles(
      { results: [{ id: 1, title: 'Scraped', summary: scraped, published_at: '2026-10-10T00:00:00Z' }] },
      { limit: 1, now: NOW },
    );
    expect(article.summary?.endsWith('…')).toBe(true);
    expect(article.summary?.length).toBeLessThanOrEqual(321);
    expect(article.summary).not.toContain('\n');
  });
});

describe('wikipedia current events', () => {
  it('builds a day page and an anonymous CORS request', () => {
    const day = new Date(Date.UTC(2026, 9, 9));
    expect(currentEventsPage(day)).toBe('Portal:Current events/2026 October 9');
    const request = currentEventsRequest(day);
    expect(request).toContain('en.wikipedia.org/w/api.php');
    expect(request).toContain('origin=*');
    const params = new URL(request).searchParams;
    expect(params.get('action')).toBe('parse');
    expect(params.get('page')).toBe('Portal:Current events/2026 October 9');
  });

  it('accepts both wikitext payload shapes', () => {
    expect(readWikitext(WIKI_BODY)).toBe(WIKITEXT);
    expect(readWikitext({ parse: { wikitext: { '*': 'legacy' } } })).toBe('legacy');
    expect(readWikitext({ parse: {} })).toBeUndefined();
  });

  it('turns wikitext into prose and citations', () => {
    const { text, citations } = cleanCurrentEvent(
      "'''Bold''' [[Page|label]] ''ital'' {{cite}} [https://example.com/x (''The Straits Times'')]",
    );
    expect(text).toBe('Bold label ital');
    expect(citations).toEqual([{ url: 'https://example.com/x', label: 'The Straits Times' }]);
  });
});

describe('current events parser', () => {
  const day = new Date(Date.UTC(2026, 9, 9));
  const articles = parseCurrentEvents(WIKITEXT, { day, limit: 10 });

  it('keeps every top-level bullet, newest day first', () => {
    expect(articles).toHaveLength(3);
    expect(articles.every((article) => article.topic === 'world')).toBe(true);
    expect(articles.every((article) => article.publishedAt === Date.UTC(2026, 9, 9))).toBe(true);
  });

  it('uses a bare label as the title and its sub-bullets as the summary', () => {
    expect(articles[1]).toMatchObject({
      title: '2026 Panama earthquake',
      summary: 'A magnitude 7.7 earthquake strikes Herrera Province, Panama.',
      source: 'AP',
      url: 'https://apnews.com/article/quake',
    });
  });

  it('uses the citing publisher, and the portal page when nothing is cited', () => {
    expect(articles[0]).toMatchObject({
      title: "Pope Leo XIV approves Filipino cardinal Luis Antonio Tagle's election.",
      source: 'Reuters',
      url: 'https://www.reuters.com/world/tagle',
      // A self-contained sentence has nothing extra to expand.
      summary: undefined,
    });
    const uncited = parseCurrentEvents('*Something happened with no citation.', { day, limit: 1 });
    expect(uncited[0].source).toBe('Wikipedia');
    expect(uncited[0].url).toBe('https://en.wikipedia.org/wiki/Portal:Current_events/2026_October_9');
  });

  it('keeps every row a unique id', () => {
    const ids = articles.map((article) => article.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('drops nested labels instead of repeating them in the prose', () => {
    // `**[[Hurricane Isaias]]` labels the story; only the `***` line is prose.
    expect(articles[2]).toMatchObject({
      title: '2026 Atlantic hurricane season',
      summary: 'Isaias strengthens into a category 3 hurricane.',
      source: 'AP',
    });
  });
});

describe('fetchNews', () => {
  const routes = {
    'hn.algolia.com': HN_BODY,
    'dev.to': DEV_BODY,
    'spaceflightnewsapi.net': SPACEFLIGHT_BODY,
    'en.wikipedia.org': WIKI_BODY,
  };

  it('asks only the providers that cover the topic', async () => {
    const fetchImpl = vi.fn(stubFetch(routes));
    const result = await fetchNews({ topic: 'science', limit: 6, now: NOW, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain('spaceflightnewsapi.net');
    expect(result.providers).toEqual(['Spaceflight News']);
    expect(result.failed).toEqual([]);
  });

  it('sorts a single topic by recency and respects the limit', async () => {
    const result = await fetchNews({
      topic: 'technology',
      limit: 2,
      now: NOW,
      fetchImpl: stubFetch(routes),
    });
    expect(result.articles).toHaveLength(2);
    expect(result.articles[0].publishedAt).toBeGreaterThan(result.articles[1].publishedAt);
  });

  it('round-robins across providers so no topic is crowded out', async () => {
    const result = await fetchNews({ topic: 'all', limit: 4, now: NOW, fetchImpl: stubFetch(routes) });
    expect(result.providers).toHaveLength(4);
    expect(result.articles).toHaveLength(4);
    expect(new Set(result.articles.map((article) => article.topic))).toEqual(
      new Set(['technology', 'product', 'science', 'world']),
    );
  });

  it('keeps the sources that answered and names the one that did not', async () => {
    const result = await fetchNews({
      topic: 'all',
      limit: 4,
      now: NOW,
      fetchImpl: stubFetch(routes, ['dev.to']),
    });
    expect(result.failed).toEqual(['DEV Community']);
    expect(result.providers).toHaveLength(3);
    expect(result.articles.every((article) => article.id.startsWith('devto-'))).toBe(false);
  });

  it('falls back only when every provider failed', async () => {
    await expect(
      fetchNews({
        topic: 'all',
        limit: 4,
        now: NOW,
        fetchImpl: stubFetch(routes, ['hn.algolia.com', 'dev.to', 'spaceflightnewsapi.net', 'en.wikipedia.org']),
      }),
    ).rejects.toBeInstanceOf(NewsError);
  });

  it('reports a cancelled request as a cancellation, not an outage', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchNews({ topic: 'product', limit: 3, now: NOW, fetchImpl: stubFetch(routes), signal: controller.signal }),
    ).rejects.toThrow(/cancelled/);
  });

  it('routes each provider to its own keyless endpoint', async () => {
    const fetchImpl = vi.fn(stubFetch(routes));
    await fetchNews({ topic: 'all', limit: 4, now: NOW, fetchImpl });
    const urls = fetchImpl.mock.calls.map((call) => String(call[0]));
    expect(urls).toContainEqual(expect.stringContaining('tags=front_page'));
    expect(urls).toContainEqual(expect.stringContaining(DEV_API));
    expect(urls).toContainEqual(expect.stringContaining('spaceflightnewsapi.net/v4/articles/'));
    expect(urls).toContainEqual(expect.stringContaining('origin=*'));
  });
});
