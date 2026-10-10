import { useCallback, useEffect } from 'react';
import type { ResolvedTheme, ThemeMode } from '@/types';
import { usePrefsStore } from '@/store/prefsStore';
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
}

const CYCLE: readonly ThemeMode[] = ['light', 'dark', 'system'];

/** Owns the `<html class="dark">` side effect and exposes theme controls. */
export function useTheme(): ThemeController {
  const theme = usePrefsStore((state) => state.theme);
  const setTheme = usePrefsStore((state) => state.setTheme);
  const prefersDark = usePrefersDark();
  const resolved: ResolvedTheme = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    root.style.colorScheme = resolved;
  }, [resolved]);

  const cycleTheme = useCallback(() => {
    const index = CYCLE.indexOf(theme);
    setTheme(CYCLE[(index + 1) % CYCLE.length]);
  }, [theme, setTheme]);

  const toggleTheme = useCallback(() => {
    setTheme(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setTheme]);

  return { theme, resolved, setTheme, cycleTheme, toggleTheme };
}
