import { useMemo } from 'react';
import { AlertIcon, CheckIcon, DownloadIcon, InfoIcon, UploadIcon } from '@/components/icons';
import { Badge, Button, Modal } from '@/components/ui';
import { parseDashboardJson } from '@/lib/validation';
import { useDashboardStore } from '@/store/dashboardStore';
import { useToastStore } from '@/store/toastStore';
import { useUiStore } from '@/store/uiStore';
import { getWidgetDefinition } from '@/widgets/registry';
import { registryValidationOptions } from '@/widgets/validationOptions';

/**
 * Import confirmation.
 *
 * The staged file is parsed and validated up front, so the user sees exactly what
 * will happen (widgets, warnings, errors) before anything is replaced.
 */
export function ImportDialog() {
  const pendingImport = useUiStore((state) => state.pendingImport);
  const clearImport = useUiStore((state) => state.clearImport);
  const loadDocument = useDashboardStore((state) => state.loadDocument);
  const success = useToastStore((state) => state.success);

  const result = useMemo(
    () => (pendingImport ? parseDashboardJson(pendingImport.text, registryValidationOptions) : null),
    [pendingImport],
  );

  if (!pendingImport || !result) return null;

  const close = () => clearImport();

  // A file the importer recognised as something other than a layout (see
  // `detectMarkupFile`) gets an explanation instead of the generic error list.
  const detectedAs = result.ok ? null : (result.detectedAs ?? null);
  const title = result.ok
    ? 'Import this layout?'
    : detectedAs === 'saved-dashboard-html'
      ? 'This is a saved dashboard, not a layout file'
      : detectedAs
        ? 'This is not a layout file'
        : 'This file cannot be imported';

  const apply = () => {
    if (!result.ok) return;
    loadDocument(result.document);
    success('Layout imported', {
      description: `${result.document.widgets.length} widgets restored from ${pendingImport.fileName}.`,
      duration: 7000,
      action: { label: 'Undo', onClick: () => useDashboardStore.getState().undo() },
    });
    clearImport();
  };

  return (
    <Modal
      open
      onClose={close}
      title={title}
      description={pendingImport.fileName}
      size="md"
      footer={
        result.ok ? (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" icon={<DownloadIcon className="h-4 w-4" />} onClick={apply}>
              Replace dashboard
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
        )
      }
    >
      {result.ok ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700/70 dark:bg-slate-950/40">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                {result.document.dashboard.title}
              </h3>
              <Badge tone="violet">{result.document.widgets.length} widgets</Badge>
              <Badge tone="slate">schema v{result.document.version}</Badge>
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Exported {new Date(result.document.exportedAt).toLocaleString()} by {result.document.generator.name}{' '}
              {result.document.generator.version}
            </p>
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Widgets in this file
            </h4>
            <ul className="space-y-1.5">
              {result.document.widgets.map((widget) => {
                const definition = getWidgetDefinition(widget.type);
                return (
                  <li key={widget.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-slate-700 dark:text-slate-200">{widget.title}</span>
                    {definition ? (
                      <Badge tone={definition.accent}>{definition.name}</Badge>
                    ) : (
                      <Badge tone="amber">plugin missing</Badge>
                    )}
                  </li>
                );
              })}
              {result.document.widgets.length === 0 ? (
                <li className="text-sm text-slate-500 dark:text-slate-400">No widgets — this would clear the canvas.</li>
              ) : null}
            </ul>
          </div>

          {result.warnings.length > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-500/30 dark:bg-amber-500/5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                <AlertIcon className="h-3.5 w-3.5" /> {result.warnings.length} warning
                {result.warnings.length === 1 ? '' : 's'}
              </p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-amber-700/90 dark:text-amber-300/90">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckIcon className="h-3.5 w-3.5" /> Everything in this file is valid.
            </p>
          )}
        </div>
      ) : detectedAs ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3 dark:border-sky-500/30 dark:bg-sky-500/5">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-sky-700 dark:text-sky-300">
              <InfoIcon className="h-3.5 w-3.5" /> {result.errors[0]}
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-sky-700/90 dark:text-sky-300/90">
              {detectedAs === 'saved-dashboard-html' ? (
                <>
                  <strong>Save to file</strong> froze your whole dashboard into a standalone HTML page. Open that file
                  — double-click it, or drag it into a browser tab — and the dashboard inside it comes back.
                </>
              ) : (
                <>Import expects the JSON written by <strong>Export layout as JSON</strong>.</>
              )}
            </p>
          </div>
          <p className="flex items-start gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <UploadIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            To move a layout between dashboards, use <strong>Export layout as JSON</strong> (
            <kbd className="rounded border border-slate-300 px-1 dark:border-slate-600">⌘/Ctrl + Shift + S</kbd>), then
            import the <code>.json</code> file it downloads.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3 dark:border-rose-500/30 dark:bg-rose-500/5">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-700 dark:text-rose-300">
              <AlertIcon className="h-3.5 w-3.5" /> {result.errors.length} problem
              {result.errors.length === 1 ? '' : 's'} found
            </p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-rose-700/90 dark:text-rose-300/90">
              {result.errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
          <p className="flex items-start gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <UploadIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Export a layout from Lotus Dashboard Creator to get a file in the expected format, then import that file.
          </p>
        </div>
      )}
    </Modal>
  );
}
