/**
 * UI preferences (persisted separately from the dashboard itself).
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { zustandStorage } from '@/lib/storage';
import { prefsStorageKey } from '@/lib/storageKeys';
import type { ThemeMode } from '@/types';

export interface PrefsState {
  /** Colour scheme preference. */
  theme: ThemeMode;
  /** Draw a subtle dot grid behind the canvas. */
  showGridHints: boolean;
  /** Ask before removing a widget. */
  confirmDelete: boolean;
  /**
   * Optional Finnhub API key, supplied by the user, used for live stock quotes.
   *
   * Kept in `localStorage` only — it is never sent anywhere except Finnhub, and
   * it travels in workspace exports only if the user shares one. The market
   * widget shows no stock prices at all without it.
   */
  finnhubKey: string;
  setTheme: (theme: ThemeMode) => void;
  setShowGridHints: (value: boolean) => void;
  setConfirmDelete: (value: boolean) => void;
  setFinnhubKey: (value: string) => void;
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'system',
      showGridHints: true,
      confirmDelete: false,
      finnhubKey: '',
      setTheme: (theme) => set({ theme }),
      setShowGridHints: (showGridHints) => set({ showGridHints }),
      setConfirmDelete: (confirmDelete) => set({ confirmDelete }),
      setFinnhubKey: (finnhubKey) => set({ finnhubKey }),
    }),
    {
      name: prefsStorageKey(),
      version: 1,
      storage: createJSONStorage(() => zustandStorage),
      partialize: (state) => ({
        theme: state.theme,
        showGridHints: state.showGridHints,
        confirmDelete: state.confirmDelete,
        finnhubKey: state.finnhubKey,
      }),
    },
  ),
);
