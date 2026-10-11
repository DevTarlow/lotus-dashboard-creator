/**
 * The shareable slice of the preferences.
 *
 * A single-file dashboard carries preferences with it, and a saved file is
 * something a user may email or drop in a chat. API keys are therefore excluded
 * by construction rather than by remembering to leave them out at each call
 * site: everything that builds a snapshot goes through {@link shareablePrefs},
 * and the returned object is a closed shape with no secret fields to leak.
 *
 * When a new secret is added to the preferences store, add it to that store and
 * to the widget settings allow-list — never to this projection.
 */
import type { EmbeddedPrefs } from './embedded';
import type { ThemeId, ThemeMode, ThemeTokens } from '@/types';

export interface ShareablePrefsInput {
  theme: ThemeMode;
  themeId: ThemeId;
  customAccentHex: string;
  customNeutralHue: number | null;
  themeTokens: ThemeTokens;
  showGridHints: boolean;
  confirmDelete: boolean;
}

/** Preferences that may travel inside a saved file. */
export function shareablePrefs(prefs: ShareablePrefsInput): EmbeddedPrefs {
  return {
    theme: prefs.theme,
    themeId: prefs.themeId,
    customAccentHex: prefs.customAccentHex,
    customNeutralHue: prefs.customNeutralHue,
    themeTokens: prefs.themeTokens,
    showGridHints: prefs.showGridHints,
    confirmDelete: prefs.confirmDelete,
  };
}
