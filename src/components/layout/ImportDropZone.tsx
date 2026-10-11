import { useCallback, useState, type DragEvent, type ReactNode } from 'react';
import { UploadIcon } from '@/components/icons';
import { useDashboardActions } from '@/hooks/useDashboardActions';
import { cn } from '@/lib/utils';

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Wraps the canvas and turns a dropped `.json` file into an import.
 * Only file drags are intercepted, so dragging widgets around still works.
 */
export function ImportDropZone({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const { importFile } = useDashboardActions();

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setActive(true);
  }, []);

  const onDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setActive(false);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setActive(false);
      const file = event.dataTransfer.files[0];
      if (file) void importFile(file);
    },
    [importFile],
  );

  return (
    <div className="relative" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {children}
      {active ? (
        <div
          className={cn(
            'pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl',
            'border-2 border-dashed border-violet-400 bg-violet-50/80 backdrop-blur-sm dark:bg-violet-500/10',
          )}
        >
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600 text-accent-fg shadow-lg">
              <UploadIcon className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold text-violet-800 dark:text-violet-200">Drop to import this layout</p>
            <p className="text-xs text-violet-600 dark:text-violet-300">
              You will see a preview before anything is replaced.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
