import { describe, expect, it } from 'vitest';
import {
  createEmbeddedState,
  EMBEDDED_ELEMENT_ID,
  EMBEDDED_FORMAT,
  encodeEmbeddedState,
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

function makeState(savedAt = 1000): EmbeddedState {
  return createEmbeddedState({
    workspace: WORKSPACE,
    prefs: { theme: 'dark', showGridHints: false, confirmDelete: true },
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
    expect(read?.prefs).toEqual({ theme: 'dark', showGridHints: false, confirmDelete: true });
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
