import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetHttp } from '@/lib/http';
import { agoLabel, fetchOnThisDay, mapOnThisDay, stripHtml, yearsAgo } from '@/lib/onthisday';

/** A trimmed payload in the shape Wikimedia sends, HTML and all. */
const PAYLOAD = {
  selected: [
    {
      year: 2021,
      text: 'The Burmese military staged a coup d&apos;état, deposing the elected government.',
      pages: [
        {
          title: 'Tatmadaw',
          displaytitle: '<span lang="en" dir="ltr"><span class="mw-page-title-main">Tatmadaw</span></span>',
          description: 'Armed forces of Myanmar',
          content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Tatmadaw' } },
          thumbnail: { source: 'https://upload.wikimedia.org/thumb/x.jpg', width: 320, height: 200 },
        },
      ],
    },
    {
      year: 1979,
      text: 'Ayatollah Khomeini returned to Tehran.',
      pages: [{ title: 'Ruhollah_Khomeini', displaytitle: 'Ruhollah Khomeini' }],
    },
    {
      year: 1900,
      text: '   ',
      pages: [],
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  resetHttp();
});

describe('stripHtml', () => {
  it('removes tags and decodes the entities the feed uses', () => {
    expect(stripHtml('<span class="mw-page-title-main">Tatmadaw</span>')).toBe('Tatmadaw');
    expect(stripHtml('Peace&nbsp;and&amp;&nbsp;“quiet”')).toBe('Peace and& “quiet”');
    expect(stripHtml("a &#39;quoted&#39; thing")).toBe("a 'quoted' thing");
    expect(stripHtml('<a href="x">link</a> &lt;tag&gt;')).toBe('link <tag>');
  });

  it('collapses whitespace', () => {
    expect(stripHtml('  one\n\n  two  ')).toBe('one two');
  });
});

describe('mapOnThisDay', () => {
  it('maps the items and strips the display title markup', () => {
    const items = mapOnThisDay(PAYLOAD, 'selected');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ year: 2021, id: '2021:Tatmadaw' });
    expect(items[0].page).toMatchObject({
      title: 'Tatmadaw',
      label: 'Tatmadaw',
      url: 'https://en.wikipedia.org/wiki/Tatmadaw',
      description: 'Armed forces of Myanmar',
      thumbnail: 'https://upload.wikimedia.org/thumb/x.jpg',
    });
    expect(items[0].text).toContain("coup d'état");
  });

  it('falls back to an underscored title and tolerates a missing thumbnail', () => {
    const items = mapOnThisDay(PAYLOAD, 'selected');
    expect(items[1].page).toMatchObject({ label: 'Ruhollah Khomeini', thumbnail: null, url: '' });
  });

  it('drops an item with no text', () => {
    expect(mapOnThisDay(PAYLOAD, 'selected')).toHaveLength(2);
  });

  it('returns nothing for the wrong desk or a foreign payload', () => {
    expect(mapOnThisDay(PAYLOAD, 'births')).toEqual([]);
    expect(mapOnThisDay({}, 'selected')).toEqual([]);
    expect(mapOnThisDay(null, 'selected')).toEqual([]);
    expect(mapOnThisDay({ selected: 'nope' }, 'selected')).toEqual([]);
  });

  it('handles an entry without pages', () => {
    const items = mapOnThisDay({ events: [{ year: 1066, text: 'A battle.' }] }, 'events');
    expect(items).toEqual([{ id: '1066:A battle.', year: 1066, text: 'A battle.', page: null }]);
  });
});

describe('fetchOnThisDay', () => {
  it('addresses the requested day and caches the answer', async () => {
    const mock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(PAYLOAD)));
    vi.stubGlobal('fetch', mock);
    const signal = new AbortController().signal;
    const date = new Date(2026, 1, 1);

    const first = await fetchOnThisDay('selected', date, signal);
    const second = await fetchOnThisDay('selected', date, signal);

    expect(String(mock.mock.calls[0][0])).toBe(
      'https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/selected/02/01',
    );
    expect(first.items).toHaveLength(2);
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(mock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('refuses a payload with no entries instead of showing an empty day', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ selected: [] }))));
    await expect(fetchOnThisDay('selected', new Date(2026, 1, 1), new AbortController().signal)).rejects.toMatchObject({
      code: 'parse',
    });
    vi.unstubAllGlobals();
  });

  it('surfaces a transport failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchOnThisDay('events', new Date(2026, 1, 1), new AbortController().signal)).rejects.toMatchObject({
      code: 'network',
    });
    vi.unstubAllGlobals();
  });
});

describe('year labels', () => {
  const now = new Date(2026, 5, 15);

  it('counts the years', () => {
    expect(yearsAgo(2021, now)).toBe(5);
    expect(yearsAgo(2026, now)).toBe(0);
    expect(yearsAgo(null, now)).toBeNull();
  });

  it('phrases them', () => {
    expect(agoLabel(2021, now)).toBe('5 years ago');
    expect(agoLabel(2025, now)).toBe('1 year ago');
    expect(agoLabel(2026, now)).toBe('this year');
    expect(agoLabel(2027, now)).toBe('next year');
    expect(agoLabel(2030, now)).toBe('in 4 years');
    expect(agoLabel(null, now)).toBeNull();
  });
});
