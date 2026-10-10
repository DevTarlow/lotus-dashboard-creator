/**
 * Toast notifications.
 *
 * Deliberately ephemeral (never persisted) and consumed by a single viewport
 * component. Auto dismissal lives in the viewport so a toast can pause its
 * timer while hovered.
 */
import { create } from 'zustand';
import type { Toast, ToastTone } from '@/types';
import { createId } from '@/lib/utils';

export interface ToastInput {
  tone?: ToastTone;
  title: string;
  description?: string;
  /** Milliseconds before auto dismissal. `0` keeps it until dismissed. */
  duration?: number;
  action?: Toast['action'];
}

export interface ToastState {
  toasts: Toast[];
  notify: (input: ToastInput) => string;
  success: (title: string, options?: Omit<ToastInput, 'title' | 'tone'>) => string;
  error: (title: string, options?: Omit<ToastInput, 'title' | 'tone'>) => string;
  info: (title: string, options?: Omit<ToastInput, 'title' | 'tone'>) => string;
  warning: (title: string, options?: Omit<ToastInput, 'title' | 'tone'>) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const DEFAULT_DURATION = 4200;
const MAX_TOASTS = 4;

export const useToastStore = create<ToastState>()((set, get) => {
  const notify = (input: ToastInput): string => {
    const toast: Toast = {
      id: createId('toast'),
      tone: input.tone ?? 'info',
      title: input.title,
      description: input.description,
      duration: input.duration ?? (input.action ? 8000 : DEFAULT_DURATION),
      action: input.action,
    };
    set((state) => ({ toasts: [...state.toasts, toast].slice(-MAX_TOASTS) }));
    return toast.id;
  };

  return {
    toasts: [],
    notify,
    success: (title, options) => notify({ ...options, title, tone: 'success' }),
    error: (title, options) => notify({ ...options, title, tone: 'error' }),
    info: (title, options) => notify({ ...options, title, tone: 'info' }),
    warning: (title, options) => notify({ ...options, title, tone: 'warning' }),
    dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
    clear: () => {
      if (get().toasts.length > 0) set({ toasts: [] });
    },
  };
});
