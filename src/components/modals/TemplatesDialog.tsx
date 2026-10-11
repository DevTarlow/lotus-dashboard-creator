import { useMemo } from 'react';
import { CheckIcon, GridIcon, RefreshIcon, SparklesIcon } from '@/components/icons';
import { Badge, Button, Modal } from '@/components/ui';
import { GRID_COLUMNS } from '@/constants/grid';
import { useDashboardActions } from '@/hooks/useDashboardActions';
import { DASHBOARD_TEMPLATES, DEFAULT_TEMPLATE_ID } from '@/lib/templates';
import { useDashboardStore } from '@/store/dashboardStore';
import { useUiStore } from '@/store/uiStore';
import type { DashboardTemplate, LayoutsByBreakpoint } from '@/types';
import { cn } from '@/lib/utils';
import { getWidgetDefinition } from '@/widgets/registry';

/** Thumbnail of a template layout, drawn from the 12 column reference layout. */
function TemplatePreview({ layouts }: { layouts: LayoutsByBreakpoint }) {
  const layout = layouts.lg ?? [];
  const rows = layout.reduce((max, item) => Math.max(max, item.y + item.h), 1);

  return (
    <div className="relative h-24 w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950/50">
      {layout.map((item) => (
        <div
          key={item.i}
          className="absolute rounded-[3px] border border-violet-300/70 bg-violet-200/70 dark:border-violet-500/40 dark:bg-violet-500/25"
          style={{
            left: `${(item.x / GRID_COLUMNS.lg) * 100}%`,
            top: `${(item.y / rows) * 100}%`,
            width: `${(item.w / GRID_COLUMNS.lg) * 100}%`,
            height: `${(item.h / rows) * 100}%`,
          }}
        />
      ))}
    </div>
  );
}

interface TemplateRowProps {
  template: DashboardTemplate;
  /** Marks the template that "Restore the starter dashboard" brings back. */
  isDefault: boolean;
  onApply: (template: DashboardTemplate) => void;
}

function TemplateRow({ template, isDefault, onApply }: TemplateRowProps) {
  // Building a template is cheap (a handful of objects) but we memoise per row so
  // opening the dialog does not rebuild it on unrelated re-renders.
  const built = useMemo(() => template.build(), [template]);

  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-3 transition sm:flex-row sm:items-center',
        isDefault
          ? 'border-violet-300 bg-violet-50/60 dark:border-violet-500/40 dark:bg-violet-500/5'
          : 'border-slate-200 hover:border-violet-200 hover:bg-slate-50/70 dark:border-slate-700/70 dark:hover:border-violet-500/30 dark:hover:bg-slate-800/40',
      )}
    >
      <div className="w-full sm:w-40 sm:shrink-0">
        <TemplatePreview layouts={built.layouts} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{template.name}</h3>
          {isDefault ? (
            <Badge tone="violet" icon={<CheckIcon className="h-3 w-3" />}>
              starter
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{template.description}</p>
        <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
          {built.widgets.length} widgets ·{' '}
          {built.widgets
            .map((widget) => getWidgetDefinition(widget.type)?.name ?? widget.type)
            .slice(0, 4)
            .join(', ')}
          {built.widgets.length > 4 ? '…' : ''}
        </p>
      </div>
      <Button
        variant={isDefault ? 'secondary' : 'primary'}
        size="sm"
        className="sm:self-center"
        icon={isDefault ? <RefreshIcon className="h-3.5 w-3.5" /> : <SparklesIcon className="h-3.5 w-3.5" />}
        onClick={() => onApply(template)}
      >
        {isDefault ? 'Restore' : 'Apply'}
      </Button>
    </article>
  );
}

/** Starter template gallery. Applying a template replaces the dashboard (undoable). */
export function TemplatesDialog() {
  const open = useUiStore((state) => state.templatesOpen);
  const close = useUiStore((state) => state.closeTemplates);
  const { applyTemplate, resetDashboard } = useDashboardActions();
  const clearDashboard = useDashboardStore((state) => state.clearDashboard);
  const widgetCount = useDashboardStore((state) => state.widgets.length);

  const handleApply = (template: DashboardTemplate) => {
    applyTemplate(template);
    close();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Templates"
      description="Start from a ready-made dashboard, or clear the canvas and build your own."
      size="lg"
      footer={
        <>
          <p className="mr-auto text-[11px] text-slate-400 dark:text-slate-500">
            Applying a template replaces the current {widgetCount} widget{widgetCount === 1 ? '' : 's'} — press ⌘/Ctrl + Z
            to undo.
          </p>
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
          <Button
            variant="primary"
            icon={<RefreshIcon className="h-4 w-4" />}
            onClick={() => {
              resetDashboard();
              close();
            }}
          >
            Restore the starter dashboard
          </Button>
        </>
      }
    >
      <div className={cn('space-y-3')}>
        {DASHBOARD_TEMPLATES.map((template) => (
          <TemplateRow
            key={template.id}
            template={template}
            isDefault={template.id === DEFAULT_TEMPLATE_ID}
            onApply={handleApply}
          />
        ))}

        {/* The missing "start over, empty" option: before this the only way to a
            clean canvas was removing every widget one at a time. */}
        <article className="flex flex-col gap-3 rounded-xl border border-dashed border-slate-300 p-3 transition sm:flex-row sm:items-center dark:border-slate-700/70">
          <div className="flex w-full items-center justify-center sm:w-40 sm:shrink-0">
            <span className="flex h-24 w-full items-center justify-center rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950/50">
              <GridIcon className="h-4 w-4 text-slate-300 dark:text-slate-600" />
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">Blank canvas</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Remove everything and add only what you want.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="sm:self-center"
            onClick={() => {
              clearDashboard();
              close();
            }}
          >
            Start blank
          </Button>
        </article>
      </div>
    </Modal>
  );
}
