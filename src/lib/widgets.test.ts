import { describe, expect, it } from 'vitest';
import { normalizeUrl, displayHost, faviconUrl, guessLabel, initialsFor, isValidUrl } from '@/widgets/links/url';
import { createWidgetInstance } from '@/widgets/factory';
import { getWeather, formatTemperature, convertTemperature, WEATHER_BUCKET_MS } from '@/lib/mock/weather';
import { getQuotes, getQuote, parseSymbolList, priceAt, resolveAsset } from '@/lib/mock/market';
import { getNewsFeed, NEWS_TOPICS } from '@/lib/mock/news';

describe('link helpers', () => {
  it('normalises user input into safe URLs', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/');
    expect(normalizeUrl('  https://react.dev/docs  ')).toBe('https://react.dev/docs');
    expect(normalizeUrl('javascript:alert(1)')).toBe('');
    expect(normalizeUrl('not a url')).toBe('');
    expect(normalizeUrl('   ')).toBe('');
    expect(isValidUrl('github.com')).toBe(true);
    expect(isValidUrl('ftp://example.com')).toBe(false);
  });

  it('derives display host, favicon and initials', () => {
    expect(displayHost('https://www.example.com/a/b')).toBe('example.com');
    expect(faviconUrl('https://news.ycombinator.com')).toContain('domain=news.ycombinator.com');
    expect(guessLabel('https://news.ycombinator.com')).toBe('Ycombinator');
    expect(initialsFor('Hacker News', 'https://news.ycombinator.com')).toBe('HN');
    expect(initialsFor('', 'https://github.com')).toBe('GI');
    expect(initialsFor('', '')).toBe('?');
  });
});

describe('mock market data', () => {
  it('is deterministic for a given moment', () => {
    const at = 1_800_000_000_000;
    expect(getQuote('BTC', at).price).toBe(getQuote('BTC', at).price);
    expect(getQuote('BTC', at).price).not.toBe(getQuote('ETH', at).price);
  });

  it('moves over time but stays inside a sane band', () => {
    const asset = resolveAsset('BTC');
    const early = priceAt(asset, 1_800_000_000_000);
    const later = priceAt(asset, 1_800_000_000_000 + 45 * 60 * 1000);
    expect(later).not.toBe(early);
    expect(later).toBeGreaterThan(asset.base * 0.7);
    expect(later).toBeLessThan(asset.base * 1.3);
  });

  it('reports intraday range and a sparkline', () => {
    const quote = getQuote('NVDA', 1_800_000_000_000);
    expect(quote.spark).toHaveLength(28);
    expect(quote.high).toBeGreaterThanOrEqual(quote.low);
    expect(quote.price).toBeGreaterThan(0);
    expect(Number.isFinite(quote.changePercent)).toBe(true);
  });

  it('synthesises unknown symbols and parses symbol lists', () => {
    const synthetic = getQuote('zzzz', 1_800_000_000_000);
    expect(synthetic.symbol).toBe('ZZZZ');
    expect(synthetic.price).toBeGreaterThan(0);
    expect(parseSymbolList('btc, eth  sol;BTC')).toEqual(['BTC', 'ETH', 'SOL', 'BTC']);
    expect(getQuotes(['BTC', 'btc', ''])).toHaveLength(1);
  });
});

describe('mock weather', () => {
  it('is stable within a bucket and independent of the city', () => {
    const bucketStart = Math.floor(1_800_000_000_000 / WEATHER_BUCKET_MS) * WEATHER_BUCKET_MS;
    const first = getWeather('Lisbon', bucketStart + 1000);
    const second = getWeather('Lisbon', bucketStart + 2000);
    expect(first.temperatureC).toBe(second.temperatureC);
    expect(getWeather('Tokyo', bucketStart).temperatureC).not.toBe(first.temperatureC);
  });

  it('produces a coherent snapshot', () => {
    const snapshot = getWeather('Reykjavik', 1_800_000_000_000);
    expect(snapshot.hourly).toHaveLength(6);
    expect(snapshot.highC).toBeGreaterThanOrEqual(snapshot.lowC);
    expect(snapshot.humidity).toBeGreaterThanOrEqual(0);
    expect(snapshot.humidity).toBeLessThanOrEqual(100);
    expect(snapshot.sunsetHour).toBeGreaterThan(snapshot.sunriseHour);
    expect(snapshot.summary.length).toBeGreaterThan(0);
    expect(snapshot.simulated).toBe(true);
  });

  it('converts temperatures', () => {
    expect(convertTemperature(0, 'imperial')).toBe(32);
    expect(formatTemperature(0, 'metric')).toBe('0°');
    expect(formatTemperature(100, 'imperial')).toBe('212°');
  });
});

describe('mock news feed', () => {
  it('respects the requested length and topic, newest first', () => {
    const feed = getNewsFeed({ topic: 'technology', limit: 3, now: 1_800_000_000_000 });
    expect(feed).toHaveLength(3);
    expect(feed.every((article) => article.topic === 'technology')).toBe(true);
    expect(feed[0].publishedAt).toBeGreaterThanOrEqual(feed[2].publishedAt);
  });

  it('supports every topic and is stable within a window', () => {
    for (const topic of NEWS_TOPICS) {
      const feed = getNewsFeed({ topic: topic.id, limit: 2, now: 1_800_000_000_000 });
      expect(feed.length, topic.id).toBeGreaterThan(0);
    }
    const a = getNewsFeed({ now: 1_800_000_000_000 });
    const b = getNewsFeed({ now: 1_800_000_000_000 });
    expect(a.map((article) => article.title)).toEqual(b.map((article) => article.title));
    const refreshed = getNewsFeed({ now: 1_800_000_000_000, seedOffset: 1 });
    expect(refreshed.map((article) => article.title)).not.toEqual(a.map((article) => article.title));
  });
});

describe('widget factory', () => {
  it('builds instances from registry defaults', () => {
    const instance = createWidgetInstance('clock');
    expect(instance).not.toBeNull();
    expect(instance?.type).toBe('clock');
    expect(instance?.title).toBe('Clock');
    expect(instance?.id).toMatch(/^clock_/);
  });

  it('applies overrides without mutating the defaults', () => {
    const first = createWidgetInstance('clock', { config: { hour12: true } });
    const second = createWidgetInstance('clock');
    expect(first?.config.hour12).toBe(true);
    expect(second?.config.hour12).toBe(false);
    expect(first?.config).not.toBe(second?.config);
  });

  it('returns null for unknown types', () => {
    expect(createWidgetInstance('missing')).toBeNull();
  });
});
