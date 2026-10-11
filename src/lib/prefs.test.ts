import { describe, expect, it } from 'vitest';
import { shareablePrefs, type ShareablePrefsInput } from '@/lib/prefs';

/** A complete, shareable preference object. */
const SHAREABLE: ShareablePrefsInput = {
  theme: 'dark',
  themeId: 'rose-quartz',
  customAccentHex: '#ec4899',
  customNeutralHue: 20,
  themeTokens: { '--color-violet-500': 'oklch(60.6% 0.190 354.000)', '--color-accent-fg': '#ffffff' },
  showGridHints: false,
  confirmDelete: true,
};

describe('shareablePrefs', () => {
  it('carries exactly the shareable preferences, theme included', () => {
    const prefs = shareablePrefs(SHAREABLE);
    expect(prefs).toEqual(SHAREABLE);
    expect(Object.keys(prefs).sort()).toEqual([
      'confirmDelete',
      'customAccentHex',
      'customNeutralHue',
      'showGridHints',
      'theme',
      'themeId',
      'themeTokens',
    ]);
  });

  it('drops every secret, whatever else is on the object', () => {
    // The runtime object is wider than the type: this is the shape that would
    // reach a saved file if the projection ever stopped being used.
    const runtimePrefs = {
      ...SHAREABLE,
      theme: 'light' as const,
      finnhubKey: 'ck_live_should_never_be_embedded',
      githubToken: 'ghp_should_never_be_embedded',
      updatedAt: 123,
    };

    const shared = shareablePrefs(runtimePrefs);
    const serialised = JSON.stringify(shared);

    expect(serialised).not.toContain('should_never_be_embedded');
    expect(serialised).not.toContain('finnhubKey');
    expect(serialised).not.toContain('githubToken');
    expect(serialised).not.toContain('updatedAt');
  });

  it('never carries "you have seen the welcome", so a recipient still gets one', () => {
    // A file is something you send someone. If this flag travelled, the person
    // who received it would be dropped into a dashboard with no explanation.
    const shared = shareablePrefs({ ...SHAREABLE, hasSeenWelcome: true } as ShareablePrefsInput);

    expect(shared).not.toHaveProperty('hasSeenWelcome');
    expect(JSON.stringify(shared)).not.toContain('hasSeenWelcome');
  });

  it('keeps the palette so the file restores the look it was saved with', () => {
    const shared = shareablePrefs(SHAREABLE);
    expect(shared.themeId).toBe('rose-quartz');
    expect(shared.themeTokens['--color-violet-500']).toBe('oklch(60.6% 0.190 354.000)');
  });
});
