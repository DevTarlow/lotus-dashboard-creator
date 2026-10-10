import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertIcon, CheckIcon, CloseIcon, InfoIcon } from '@/components/icons';
import { useToastStore } from '@/store/toastStore';
import type { Toast, ToastTone } from '@/types';
import { cn } from '@/lib/utils';

const TONE_STYLES: Record<ToastTone, { wrapper: string; icon: string; Icon: typeof CheckIcon }> = {
  success: {
    wrapper: 'border-emerald-200 bg-white dark:border-emerald-500/30 dark:bg-slate-900',
    icon: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
    Icon: CheckIcon,
  },
  error: {
    wrapper: 'border-rose-200 bg-white dark:border-rose-500/30 dark:bg-slate-900',
    icon: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400',
    Icon: AlertIcon,
  },
  warning: {
    wrapper: 'border-amber-200 bg-white dark:border-amber-500/30 dark:bg-slate-900',
    icon: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
    Icon: AlertIcon,
  },
  info: {
    wrapper: 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
    icon: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300',
    Icon: InfoIcon,
  },
};

/** Single toast with hover-to-pause auto dismissal. */
function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((state) => state.dismiss);
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(toast.duration);
  const startedAtRef = useRef(0);
  const tone = TONE_STYLES[toast.tone];
  const { Icon } = tone;

  useEffect(() => {
    if (toast.duration <= 0 || paused) return undefined;
    startedAtRef.current = Date.now();
    const timer = setTimeout(() => dismiss(toast.id), remainingRef.current);
    return () => {
      clearTimeout(timer);
      remainingRef.current = Math.max(800, remainingRef.current - (Date.now() - startedAtRef.current));
    };
  }, [dismiss, paused, toast.duration, toast.id]);

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        'pointer-events-auto flex w-full animate-toast-in items-start gap-3 rounded-xl border p-3 shadow-lg shadow-slate-900/5',
        tone.wrapper,
      )}
    >
      <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', tone.icon)} aria-hidden="true">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{toast.title}</p>
        {toast.description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{toast.description}</p>
        ) : null}
        {toast.action ? (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick();
              dismiss(toast.id);
            }}
            className="mt-2 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {toast.action.label}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Dismiss notification"
        className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Bottom-right toast stack. */
export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);
  if (toasts.length === 0) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[22rem]">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>,
    document.body,
  );
}
