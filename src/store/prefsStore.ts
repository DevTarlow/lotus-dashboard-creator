/**
 * UI preferences (persisted separately from the dashboard itself).
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { readEmbeddedState, shouldPreferEmbedded } from '@/lib/embedded';
import { zustandStorage } from '@/lib/storage';
import { prefsStorageKey } from '@/lib/storageKeys';
import {
  normalizeThemeInput,
  resolveThemeTokens,
  sameThemeTokens,
  type ResolvedThemeInput,
} from '@/lib/theme';
import { asNumber } from '@/lib/utils';
import type { ThemeId, ThemeMode, ThemeTokens } from '@/types';

/**
 * Preference fields that hold a secret a widget setting may write to.
 *
 * The settings form binds a `password` field whose key appears here to the
 * preferences store instead of to the widget's config — so the value is kept in
 * `localStorage`, never exported and never embedded in a saved file. It is also
 * the allow-list that stops a schema-driven write reaching an arbitrary field.
 */
export const PREF_SECRET_KEYS = ['finnhubKey', 'githubToken'] as const;

export type PrefSecretKey = (typeof PREF_SECRET_KEYS)[number];

/** `true` when a settings key names a preference rather than a config field. */
export function isPrefSecretKey(key: string): key is PrefSecretKey {
  return (PREF_SECRET_KEYS as readonly string[]).includes(key);
}

export interface PrefsState {
  /** Colour scheme preference. */
  theme: ThemeMode;
  /**
   * Palette preset. A preset re-hues the neutral and accent scales the whole
   * interface is built from — see `lib/theme.ts`.
   */
  themeId: ThemeId;
  /** Accent override as `#rrggbb`, or `''` to use the preset's accent. */
  customAccentHex: string;
  /** Neutral warmth override in degrees, or `null` to use the preset's hue. */
  customNeutralHue: number | null;
  /**
   * The resolved palette, applied to `<html>` as CSS custom properties.
   *
   * Derived from the three fields above, and kept in the store because the
   * inline script in `index.html` needs it *before* the bundle runs — it cannot
   * resolve a preset without importing the engine. It is never trusted on load:
   * the store regenerates it (see `refreshThemeTokens`).
   */
  themeTokens: ThemeTokens;
  /** Draw a subtle dot grid behind the canvas. */
  showGridHints: boolean;
  /** Ask before removing a widget. */
  confirmDelete: boolean;
  /**
   * `true` once the first-run welcome has been dismissed.
   *
   * Kept in this browser only, deliberately: a dashboard file is shareable, and
   * the person who receives one has never seen the welcome. It is excluded from
   * `lib/prefs.ts` (the projection a saved file carries) by construction.
   */
  hasSeenWelcome: boolean;
  /**
   * Optional Finnhub API key, supplied by the user, used for live stock quotes.
   *
   * Kept in `localStorage` only — it is never sent anywhere except Finnhub, and
   * it is deliberately excluded from workspace exports and from the snapshot
   * embedded in a single-file dashboard, so sharing a file never leaks it. The
   * market widget shows no stock prices at all without it.
   */
  finnhubKey: string;
  /**
   * Optional GitHub personal access token, used for the repository widget.
   *
   * Anonymous `api.github.com` requests are limited to 60 per hour per address,
   * which a dashboard watching a few repositories can exhaust. A token raises
   * that to 5,000. Like the Finnhub key it stays in `localStorage`: it is never
   * embedded in a saved file and is sent only to GitHub.
   */
  githubToken: string;
  /** Epoch ms of the last preference change, used for embedded-state precedence. */
  updatedAt: number;
  setTheme: (theme: ThemeMode) => void;
  /** Pick a palette preset, clearing any accent/warmth overrides. */
  setThemePreset: (themeId: ThemeId) => void;
  setCustomAccentHex: (hex: string) => void;
  setCustomNeutralHue: (hue: number | null) => void;
  /** Back to the default palette: preset and both overrides. */
  resetAppearance: () => void;
  /**
   * Re-resolve the palette from the current inputs and persist it if it changed.
   *
   * Called once on mount. It is what picks up retuned or added presets after an
   * upgrade, and what repairs a cache written by an older build — without a
   * stored schema version to keep in step, and without stamping `updatedAt`,
   * because nothing the user chose has changed.
   */
  refreshThemeTokens: () => void;
  setShowGridHints: (value: boolean) => void;
  setConfirmDelete: (value: boolean) => void;
  setHasSeenWelcome: (value: boolean) => void;
  setFinnhubKey: (value: string) => void;
  setGithubToken: (value: string) => void;
}

/** Preferences worth carrying inside a single-file dashboard. */
type PersistedPrefs = Pick<
  PrefsState,
  | 'theme'
  | 'themeId'
  | 'customAccentHex'
  | 'customNeutralHue'
  | 'themeTokens'
  | 'showGridHints'
  | 'confirmDelete'
  | 'hasSeenWelcome'
  | 'finnhubKey'
  | 'githubToken'
  | 'updatedAt'
>;

/** Theme fields of whatever source won the precedence check. */
function themeInputFrom(source: {
  themeId?: unknown;
  customAccentHex?: unknown;
  customNeutralHue?: unknown;
}): ResolvedThemeInput {
  return normalizeThemeInput({
    themeId: source.themeId,
    customAccentHex: source.customAccentHex,
    customNeutralHue: source.customNeutralHue,
  });
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set, get) => {
      /**
       * Apply a theme change.
       *
       * The palette is derived here rather than in a component effect so every
       * writer — the picker, a slider drag, hydration — produces exactly one
       * canonical token set, and stamps `updatedAt` so a local edit keeps
       * outranking the file it was opened from.
       */
      const applyTheme = (patch: Partial<ResolvedThemeInput>) => {
        const current = get();
        const input = normalizeThemeInput({
          themeId: patch.themeId ?? current.themeId,
          customAccentHex: patch.customAccentHex ?? current.customAccentHex,
          customNeutralHue: patch.customNeutralHue === undefined ? current.customNeutralHue : patch.customNeutralHue,
        });
        set({ ...input, themeTokens: resolveThemeTokens(input), updatedAt: Date.now() });
      };

      return {
        theme: 'system',
        themeId: 'lotus',
        customAccentHex: '',
        customNeutralHue: null,
        themeTokens: {},
        showGridHints: true,
        confirmDelete: false,
        hasSeenWelcome: false,
        finnhubKey: '',
        githubToken: '',
        updatedAt: 0,
        // Each setter stamps `updatedAt`, so a local edit outranks the file.
        setTheme: (theme) => set({ theme, updatedAt: Date.now() }),
        setThemePreset: (themeId) => applyTheme({ themeId, customAccentHex: '', customNeutralHue: null }),
        setCustomAccentHex: (hex) => applyTheme({ customAccentHex: hex }),
        setCustomNeutralHue: (hue) => applyTheme({ customNeutralHue: hue }),
        resetAppearance: () => applyTheme({ themeId: 'lotus', customAccentHex: '', customNeutralHue: null }),
        refreshThemeTokens: () => {
          const { themeId, customAccentHex, customNeutralHue, themeTokens } = get();
          const input = themeInputFrom({ themeId, customAccentHex, customNeutralHue });
          const refreshed = resolveThemeTokens(input);
          if (sameThemeTokens(refreshed, themeTokens)) return;
          // No `updatedAt` stamp: regenerating a cache is not a user edit.
          set({ ...input, themeTokens: refreshed });
        },
        setShowGridHints: (showGridHints) => set({ showGridHints, updatedAt: Date.now() }),
        setConfirmDelete: (confirmDelete) => set({ confirmDelete, updatedAt: Date.now() }),
        setHasSeenWelcome: (hasSeenWelcome) => set({ hasSeenWelcome, updatedAt: Date.now() }),
        setFinnhubKey: (finnhubKey) => set({ finnhubKey, updatedAt: Date.now() }),
        setGithubToken: (githubToken) => set({ githubToken, updatedAt: Date.now() }),
      };
    },
    {
      name: prefsStorageKey(),
      version: 1,
      storage: createJSONStorage(() => zustandStorage),
      partialize: (state): PersistedPrefs => ({
        theme: state.theme,
        themeId: state.themeId,
        customAccentHex: state.customAccentHex,
        customNeutralHue: state.customNeutralHue,
        themeTokens: state.themeTokens,
        showGridHints: state.showGridHints,
        confirmDelete: state.confirmDelete,
        hasSeenWelcome: state.hasSeenWelcome,
        finnhubKey: state.finnhubKey,
        githubToken: state.githubToken,
        updatedAt: state.updatedAt,
      }),
      /**
       * A single-file dashboard embeds the shareable preferences (never the API
       * key). Use them only when the file is newer than this browser's copy.
       */
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<PersistedPrefs>;
        const embedded = readEmbeddedState();
        const preferEmbedded =
          shouldPreferEmbedded(embedded, asNumber(stored.updatedAt, 0)) && Boolean(embedded?.prefs);
        const source = preferEmbedded ? (embedded?.prefs ?? {}) : stored;
        const themeInput = themeInputFrom(source);

        return {
          // Keep everything local (`finnhubKey` above all) and override only the
          // shareable preferences the file carries.
          ...current,
          ...stored,
          ...(preferEmbedded
            ? {
                theme: (embedded?.prefs?.theme ?? current.theme) as ThemeMode,
                showGridHints: embedded?.prefs?.showGridHints ?? current.showGridHints,
                confirmDelete: embedded?.prefs?.confirmDelete ?? current.confirmDelete,
                updatedAt: embedded?.savedAt ?? current.updatedAt,
              }
            : null),
          ...themeInput,
          // Recompute rather than trust: a cached palette may come from a file,
          // from an older build, or from a hand-edited `localStorage` entry.
          themeTokens: resolveThemeTokens(themeInput),
        };
      },
    },
  ),
);
