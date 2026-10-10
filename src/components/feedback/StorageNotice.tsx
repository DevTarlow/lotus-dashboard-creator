import { useState } from 'react';
import { AlertIcon, CloseIcon } from '@/components/icons';
import { IconButton } from '@/components/ui';
import { isPersistentStorage } from '@/lib/storage';

/**
 * Warns when the browser refuses to persist anything.
 *
 * `lib/storage.ts` silently degrades to an in-memory map when `localStorage` is
 * blocked (private windows, locked-down site data, some embedded webviews). The
 * app keeps working perfectly — until the next refresh, when every change is
 * gone. That silence is the trap this banner removes.
 *
 * Rendered once, above the canvas. Dismissible, because the user may have no
 * control over the policy and should not be nagged forever.
 */
export function StorageNotice() {
  const [dismissed, setDismissed] = useState(false);

  // Evaluated at module load, so this never changes during a session.
  if (dismissed || isPersistentStorage()) return null;

  return (
    <div
      role="status"
      className="border-b border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <div className="mx-auto flex max-w-[1800px] items-start gap-3 px-4 py-2.5 text-xs sm:px-6 lg:px-8">
        <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="min-w-0 flex-1">
          <span className="font-semibold">This browser is blocking local storage</span>, so your layout and
          settings will be lost when you refresh or close the tab.{' '}
          <span className="text-amber-800/90 dark:text-amber-200/80">
            Use <strong>Save to file</strong> to keep your dashboard in a single HTML file you can reopen — or{' '}
            <strong>Export layout as JSON</strong> for a portable backup.
          </span>
        </p>
        <IconButton
          label="Dismiss storage warning"
          size="icon-sm"
          variant="ghost"
          className="-mr-1 -mt-0.5 shrink-0 text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-500/20"
          icon={<CloseIcon className="h-3.5 w-3.5" />}
          onClick={() => setDismissed(true)}
        />
      </div>
    </div>
  );
}
