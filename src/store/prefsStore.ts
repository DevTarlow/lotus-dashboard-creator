/**
 * UI preferences (persisted separately from the dashboard itself).
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { readEmbeddedState, shouldPreferEmbedded } from '@/lib/embedded';
import { zustandStorage } from '@/lib/storage';
import { prefsStorageKey } from '@/lib/storageKeys';
import { asNumber } from '@/lib/utils';
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
   * it is deliberately excluded from workspace exports and from the snapshot
   * embedded in a single-file dashboard, so sharing a file never leaks it. The
   * market widget shows no stock prices at all without it.
   */
  finnhubKey: string;
  /** Epoch ms of the last preference change, used for embedded-state precedence. */
  updatedAt: number;
  setTheme: (theme: ThemeMode) => void;
  setShowGridHints: (value: boolean) => void;
  setConfirmDelete: (value: boolean) => void;
  setFinnhubKey: (value: string) => void;
}

/** Preferences worth carrying inside a single-file dashboard. */
type PersistedPrefs = Pick<PrefsState, 'theme' | 'showGridHints' | 'confirmDelete' | 'finnhubKey' | 'updatedAt'>;

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'system',
      showGridHints: true,
      confirmDelete: false,
      finnhubKey: '',
      updatedAt: 0,
      // Each setter stamps `updatedAt`, so a local edit outranks the file.
      setTheme: (theme) => set({ theme, updatedAt: Date.now() }),
      setShowGridHints: (showGridHints) => set({ showGridHints, updatedAt: Date.now() }),
      setConfirmDelete: (confirmDelete) => set({ confirmDelete, updatedAt: Date.now() }),
      setFinnhubKey: (finnhubKey) => set({ finnhubKey, updatedAt: Date.now() }),
    }),
    {
      name: prefsStorageKey(),
      version: 1,
      storage: createJSONStorage(() => zustandStorage),
      partialize: (state): PersistedPrefs => ({
        theme: state.theme,
        showGridHints: state.showGridHints,
        confirmDelete: state.confirmDelete,
        finnhubKey: state.finnhubKey,
        updatedAt: state.updatedAt,
      }),
      /**
       * A single-file dashboard embeds the shareable preferences (never the API
       * key). Use them only when the file is newer than this browser's copy.
       */
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<PersistedPrefs>;
        const embedded = readEmbeddedState();
        if (shouldPreferEmbedded(embedded, asNumber(stored.updatedAt, 0)) && embedded?.prefs) {
          return {
            // Keep everything local (`finnhubKey` above all) and override only the
            // shareable preferences the file carries.
            ...current,
            ...stored,
            theme: embedded.prefs.theme,
            showGridHints: embedded.prefs.showGridHints,
            confirmDelete: embedded.prefs.confirmDelete,
            updatedAt: embedded.savedAt,
          };
        }
        return { ...current, ...stored };
      },
    },
  ),
);
