import { describe, expect, it } from 'vitest';
import {
  createEmbeddedState,
  detectMarkupFile,
  EMBEDDED_ELEMENT_ID,
  EMBEDDED_FORMAT,
  encodeEmbeddedState,
  hasEmbeddedSnapshot,
  readEmbeddedState,
  shouldPreferEmbedded,
  type DocumentLike,
  type EmbeddedState,
} from '@/lib/embedded';

function documentWith(text: string | null): DocumentLike {
  return { getElementById: (id) => (id === EMBEDDED_ELEMENT_ID && text !== null ? { textContent: text } : null) };
}

const WORKSPACE = {
  title: 'Ops wall',
  description: '',
  widgets: [{ id: 'clock_1', type: 'clock', title: 'Clock', config: {}, createdAt: 1 }],
  layouts: {},
  locked: false,
};

/** A theme as the picker would have written it, for round-trip assertions. */
const PREFS = {
  theme: 'dark',
  themeId: 'rose-quartz',
  customAccentHex: '#ec4899',
  customNeutralHue: 20,
  themeTokens: {
    '--color-violet-500': 'oklch(60.6% 0.190 354.000)',
    '--color-accent-fg': '#ffffff',
  },
  showGridHints: false,
  confirmDelete: true,
} as const;

function makeState(savedAt = 1000): EmbeddedState {
  return createEmbeddedState({
    workspace: WORKSPACE,
    prefs: { ...PREFS, themeTokens: { ...PREFS.themeTokens } },
    savedAt,
  });
}

describe('createEmbeddedState', () => {
  it('stamps the format, generator and timestamp', () => {
    const state = makeState(1234);
    expect(state.format).toBe(EMBEDDED_FORMAT);
    expect(state.version).toBe(1);
    expect(state.savedAt).toBe(1234);
    expect(state.generator.name).toBe('Lotus Dashboard Creator');
    // The workspace carries the same stamp, so precedence uses one clock.
    expect(state.workspace.updatedAt).toBe(1234);
  });

  it('omits the Finnhub key — it must never be written into a shareable file', () => {
    const state = makeState();
    expect(JSON.stringify(state)).not.toContain('finnhub');
  });
});

describe('encodeEmbeddedState', () => {
  it('escapes `</` so a widget containing a closing script tag cannot end the element', () => {
    const state = createEmbeddedState({
      workspace: {
        ...WORKSPACE,
        widgets: [{ id: 'notes_1', type: 'notes', title: 'x', config: { text: '</script><b>hi' }, createdAt: 1 }],
      },
      prefs: null,
      savedAt: 5,
    });
    const encoded = encodeEmbeddedState(state);
    expect(encoded).not.toContain('</script');
    expect(encoded).toContain('<\\/script');
    // Still valid JSON, and the original text survives the round trip.
    const decoded = JSON.parse(encoded) as EmbeddedState;
    expect((decoded.workspace.widgets as Array<{ config: { text: string } }>)[0].config.text).toBe('</script><b>hi');
  });
});

describe('readEmbeddedState', () => {
  it('returns null when there is no document (tests, SSR)', () => {
    expect(readEmbeddedState(undefined)).toBeNull();
  });

  it('returns null when the page has no embedded block', () => {
    expect(readEmbeddedState(documentWith(null))).toBeNull();
  });

  it('reads a valid payload back', () => {
    const text = encodeEmbeddedState(makeState(4242));
    const read = readEmbeddedState(documentWith(text));
    expect(read?.savedAt).toBe(4242);
    expect(read?.prefs).toEqual(PREFS);
    expect((read?.workspace as { title: string }).title).toBe('Ops wall');
  });

  it('rejects a foreign or corrupt payload rather than throwing', () => {
    expect(readEmbeddedState(documentWith('{"format":"something-else/v1"}'))).toBeNull();
    expect(readEmbeddedState(documentWith('{ not json'))).toBeNull();
    expect(readEmbeddedState(documentWith('   '))).toBeNull();
    // Right format marker but no workspace to restore.
    expect(readEmbeddedState(documentWith('{"format":"lotus-embedded/v1"}'))).toBeNull();
  });

  it('tolerates a missing or non-numeric timestamp', () => {
    const read = readEmbeddedState(documentWith('{"format":"lotus-embedded/v1","workspace":{}}'));
    expect(read?.savedAt).toBe(0);
  });

  it('sanitises the preference block of a file it did not write', () => {
    // A saved dashboard may arrive from anywhere: colours must be validated and
    // unknown keys dropped before they reach the DOM or the store.
    const hostile = {
      format: 'lotus-embedded/v1',
      workspace: { title: 'x' },
      savedAt: 10,
      prefs: {
        theme: 'chartreuse',
        themeId: 'not-a-preset',
        customAccentHex: 'javascript:alert(1)',
        customNeutralHue: 9999,
        themeTokens: {
          '--color-slate-50': 'url(https://example.com/track.png)',
          '--color-accent-fg': '#000000',
          '--evil': 'oklch(1% 0 0)',
        },
        showGridHints: 'yes',
        confirmDelete: 1,
      },
    };
    const read = readEmbeddedState(documentWith(JSON.stringify(hostile)));

    expect(read?.prefs).toEqual({
      theme: 'system',
      themeId: 'lotus',
      customAccentHex: '',
      customNeutralHue: 360,
      themeTokens: { '--color-accent-fg': '#000000' },
      showGridHints: true,
      // A non-boolean falls back to the store's default, which is "ask first".
      confirmDelete: true,
    });
  });

  it('falls back to no preferences rather than a half-parsed block', () => {
    expect(readEmbeddedState(documentWith('{"format":"lotus-embedded/v1","workspace":{},"prefs":[]}'))?.prefs).toBeNull();
    expect(readEmbeddedState(documentWith('{"format":"lotus-embedded/v1","workspace":{},"prefs":"x"}'))?.prefs).toBeNull();
  });

  it('accepts a file from before theming existed, defaulting to the lotus palette', () => {
    const legacy = { format: 'lotus-embedded/v1', workspace: {}, savedAt: 5, prefs: { theme: 'light', showGridHints: false, confirmDelete: true } };
    expect(readEmbeddedState(documentWith(JSON.stringify(legacy)))?.prefs).toEqual({
      theme: 'light',
      themeId: 'lotus',
      customAccentHex: '',
      customNeutralHue: null,
      themeTokens: {},
      showGridHints: false,
      confirmDelete: true,
    });
  });
});

describe('detectMarkupFile', () => {
  /** Roughly what "Save to file" writes: a page plus the snapshot element. */
  const saved = `<!doctype html>
<html lang="en"><head><title>Lotus</title></head>
<body><div id="root"></div>
<script type="application/json" id="${EMBEDDED_ELEMENT_ID}">${encodeEmbeddedState(makeState(7))}</script>
</body></html>`;

  it('recognises a file this app saved', () => {
    expect(detectMarkupFile(saved)).toBe('saved-dashboard-html');
    expect(hasEmbeddedSnapshot(saved)).toBe(true);
  });

  it('recognises a snapshot element whatever the attribute order', () => {
    expect(hasEmbeddedSnapshot(`<script id="${EMBEDDED_ELEMENT_ID}" type="application/json">{}</script>`)).toBe(true);
    expect(hasEmbeddedSnapshot(`<script type="application/json" ID='${EMBEDDED_ELEMENT_ID}'></script>`)).toBe(true);
  });

  it('does not mistake a similar but different id for our snapshot', () => {
    expect(hasEmbeddedSnapshot(`<script id="${EMBEDDED_ELEMENT_ID}-backup"></script>`)).toBe(false);
    expect(hasEmbeddedSnapshot('<script id="other"></script>')).toBe(false);
  });

  it('flags any other markup as a plain web page', () => {
    expect(detectMarkupFile('<!doctype html><html><body>hello</body></html>')).toBe('html');
    expect(detectMarkupFile('\n  <?xml version="1.0"?><svg/>')).toBe('html');
  });

  it('returns null for text that is not markup', () => {
    expect(detectMarkupFile('{ not json')).toBeNull();
    expect(detectMarkupFile('')).toBeNull();
    // JSON that merely contains a "<" much later is still not markup.
    expect(detectMarkupFile(`{"note":"${'x'.repeat(2000)}<b>"}`)).toBeNull();
  });
});

describe('shouldPreferEmbedded', () => {
  it('prefers the file when it is newer than the browser copy', () => {
    expect(shouldPreferEmbedded(makeState(2000), 1000)).toBe(true);
  });

  it('prefers the browser copy when it is newer (an unsaved local edit)', () => {
    expect(shouldPreferEmbedded(makeState(1000), 2000)).toBe(false);
  });

  it('prefers the browser copy on a tie, so a file alone never overrides work', () => {
    expect(shouldPreferEmbedded(makeState(1000), 1000)).toBe(false);
  });

  it('seeds from the file when this browser has never saved anything', () => {
    expect(shouldPreferEmbedded(makeState(1), 0)).toBe(true);
  });

  it('is false when there is no embedded state', () => {
    expect(shouldPreferEmbedded(null, 0)).toBe(false);
  });
});
