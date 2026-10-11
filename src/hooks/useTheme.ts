import { useCallback, useEffect, useLayoutEffect } from 'react';
import type { ResolvedTheme, ThemeId, ThemeMode } from '@/types';
import { usePrefsStore } from '@/store/prefsStore';
import { THEME_TOKEN_KEYS } from '@/lib/theme';
import { usePrefersDark } from './useMediaQuery';

export interface ThemeController {
  /** User preference. */
  theme: ThemeMode;
  /** Theme actually applied right now. */
  resolved: ResolvedTheme;
  setTheme: (theme: ThemeMode) => void;
  /** Cycle light → dark → system. */
  cycleTheme: () => void;
  /** Flip between light and dark. */
  toggleTheme: () => void;
  /** Palette preset in use. */
  themeId: ThemeId;
  setThemePreset: (themeId: ThemeId) => void;
  /** Accent override as `#rrggbb`, or `''` for the preset's accent. */
  customAccentHex: string;
  setCustomAccentHex: (hex: string) => void;
  /** Neutral warmth override in degrees, or `null` for the preset's hue. */
  customNeutralHue: number | null;
  setCustomNeutralHue: (hue: number | null) => void;
  /** Preset and both overrides back to the default. */
  resetAppearance: () => void;
}

const CYCLE: readonly ThemeMode[] = ['light', 'dark', 'system'];

/**
 * Owns every side effect on `<html>` — the dark class, the colour scheme, the
 * preset attribute and the palette's CSS custom properties — and exposes the
 * theme controls.
 *
 * The palette is applied as inline custom properties on the root element. That
 * is the whole mechanism behind preset theming: Tailwind v4 compiles, say,
 * `bg-slate-900` to `background-color: var(--color-slate-900)`, so overriding
 * the variable recolours every utility that reads it, everywhere, without a
 * single call site knowing that themes exist.
 */
export function useTheme(): ThemeController {
  const theme = usePrefsStore((state) => state.theme);
  const setTheme = usePrefsStore((state) => state.setTheme);
  const themeId = usePrefsStore((state) => state.themeId);
  const themeTokens = usePrefsStore((state) => state.themeTokens);
  const customAccentHex = usePrefsStore((state) => state.customAccentHex);
  const customNeutralHue = usePrefsStore((state) => state.customNeutralHue);
  const setThemePreset = usePrefsStore((state) => state.setThemePreset);
  const setCustomAccentHex = usePrefsStore((state) => state.setCustomAccentHex);
  const setCustomNeutralHue = usePrefsStore((state) => state.setCustomNeutralHue);
  const resetAppearance = usePrefsStore((state) => state.resetAppearance);
  const refreshThemeTokens = usePrefsStore((state) => state.refreshThemeTokens);
  const prefersDark = usePrefersDark();
  const resolved: ResolvedTheme = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;

  /**
   * Regenerate the cached palette once per session.
   *
   * The store derives tokens whenever they are set, but a cache written by an
   * older build (or retuned preset data) would otherwise survive until the user
   * next touched the picker. Idempotent, and it only writes when something
   * actually changed.
   */
  useEffect(() => {
    refreshThemeTokens();
  }, [refreshThemeTokens]);

  // Layout effect, not a passive one: switching presets must not show a frame
  // painted with half of the old palette.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    root.style.colorScheme = resolved;
    root.dataset.theme = themeId;

    for (const key of THEME_TOKEN_KEYS) {
      const value = themeTokens[key];
      if (typeof value === 'string' && value !== '') root.style.setProperty(key, value);
      // No token for this key (or an empty one): fall back to Tailwind's own
      // value for the scale rather than leaving a stale colour behind.
      else root.style.removeProperty(key);
    }
  }, [resolved, themeId, themeTokens]);

  const cycleTheme = useCallback(() => {
    const index = CYCLE.indexOf(theme);
    setTheme(CYCLE[(index + 1) % CYCLE.length]);
  }, [theme, setTheme]);

  const toggleTheme = useCallback(() => {
    setTheme(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setTheme]);

  return {
    theme,
    resolved,
    setTheme,
    cycleTheme,
    toggleTheme,
    themeId,
    setThemePreset,
    customAccentHex,
    setCustomAccentHex,
    customNeutralHue,
    setCustomNeutralHue,
    resetAppearance,
  };
}
