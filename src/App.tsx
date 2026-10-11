import { useEffect, useRef } from 'react';
import { AlertIcon, RefreshIcon } from '@/components/icons';
import { Button } from '@/components/ui';
import { ErrorBoundary } from '@/components/feedback/ErrorBoundary';
import { SeedNotice } from '@/components/feedback/SeedNotice';
import { StorageNotice } from '@/components/feedback/StorageNotice';
import { ToastViewport } from '@/components/feedback/ToastViewport';
import { DashboardCanvas, HeaderBar, ImportDropZone, StatusBar } from '@/components/layout';
import {
  AddWidgetDrawer,
  AppearanceDialog,
  ImportDialog,
  HelpDialog,
  TemplatesDialog,
  WelcomeDialog,
  WidgetDeleteFlow,
  WidgetSettingsModal,
} from '@/components/modals';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { useTheme } from '@/hooks/useTheme';
import { useDashboardStore } from '@/store/dashboardStore';
import { usePrefsStore } from '@/store/prefsStore';
import { useUiStore } from '@/store/uiStore';

/** Last resort screen: the shell itself failed to render. */
function CrashScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
          <AlertIcon className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-base font-semibold text-slate-900 dark:text-white">Something went wrong</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{message}</p>
        </div>
        <div className="flex justify-center gap-2">
          <Button variant="primary" icon={<RefreshIcon className="h-4 w-4" />} onClick={onRetry}>
            Try again
          </Button>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload the app
          </Button>
        </div>
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          Your layout lives in localStorage and is not affected by this error.
        </p>
      </div>
    </div>
  );
}

/**
 * Application shell: toolbar, canvas, status bar and every overlay.
 *
 * Overlays are mounted once at the root and driven by `uiStore`, which keeps the
 * canvas itself free of dialog state.
 */
export default function App() {
  useTheme();
  useGlobalShortcuts();

  const title = useDashboardStore((state) => state.title);
  const seedOrigin = useDashboardStore((state) => state.seedOrigin);
  const hasSeenWelcome = usePrefsStore((state) => state.hasSeenWelcome);
  const openWelcome = useUiStore((state) => state.openWelcome);
  const welcomeConsidered = useRef(false);

  useDocumentTitle(title);

  // Once per page load: a document with nothing stored for it gets the welcome.
  // `hasSeenWelcome` is a local preference and never travels inside a file, so
  // someone who receives a dashboard still sees it.
  useEffect(() => {
    if (welcomeConsidered.current) return;
    welcomeConsidered.current = true;
    if (seedOrigin === 'fresh' && !hasSeenWelcome) openWelcome();
  }, [seedOrigin, hasSeenWelcome, openWelcome]);

  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <div className="min-h-full bg-slate-50 dark:bg-slate-950">
          <CrashScreen message={error.message} onRetry={reset} />
        </div>
      )}
    >
      <div className="flex min-h-full flex-col bg-slate-50 dark:bg-slate-950">
        <HeaderBar />
        <SeedNotice />
        <StorageNotice />

        <main className="mx-auto w-full max-w-[1800px] flex-1 px-4 py-5 sm:px-6 lg:px-8">
          <ImportDropZone>
            <DashboardCanvas />
          </ImportDropZone>
        </main>

        <StatusBar />
      </div>

      <AddWidgetDrawer />
      <WidgetSettingsModal />
      <TemplatesDialog />
      <AppearanceDialog />
      <ImportDialog />
      <WidgetDeleteFlow />
      <WelcomeDialog />
      <HelpDialog />
      <ToastViewport />
    </ErrorBoundary>
  );
}
