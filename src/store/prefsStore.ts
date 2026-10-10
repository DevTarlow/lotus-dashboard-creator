/**
 * UI preferences (persisted separately from the dashboard itself).
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { STORAGE_KEYS } from '@/constants/app';
import { zustandStorage } from '@/lib/storage';
import type { ThemeMode } from '@/types';

export interface PrefsState {
  /** Colour scheme preference. */
  theme: ThemeMode;
  /** Draw a subtle dot grid behind the canvas. */
  showGridHints: boolean;
  /** Ask before removing a widget. */
  confirmDelete: boolean;
  setTheme: (theme: ThemeMode) => void;
  setShowGridHints: (value: boolean) => void;
  setConfirmDelete: (value: boolean) => void;
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'system',
      showGridHints: true,
      confirmDelete: false,
      setTheme: (theme) => set({ theme }),
      setShowGridHints: (showGridHints) => set({ showGridHints }),
      setConfirmDelete: (confirmDelete) => set({ confirmDelete }),
    }),
    {
      name: STORAGE_KEYS.prefs,
      version: 1,
      storage: createJSONStorage(() => zustandStorage),
      partialize: (state) => ({
        theme: state.theme,
        showGridHints: state.showGridHints,
        confirmDelete: state.confirmDelete,
      }),
    },
  ),
);
