import { useMemo, useState } from 'react';
import { PlusIcon, SearchIcon } from '@/components/icons';
import { Badge, Button, Drawer, EmptyState, IconChip, TextInput } from '@/components/ui';
import { WIDGET_DRAG_MIME } from '@/constants/app';
import { useDashboardActions } from '@/hooks/useDashboardActions';
import { useDashboardStore } from '@/store/dashboardStore';
import { useUiStore } from '@/store/uiStore';
import type { WidgetCategory, WidgetDefinition } from '@/types';
import { cn } from '@/lib/utils';
import { availableCategories, searchWidgetDefinitions } from '@/widgets/registry';

interface WidgetCardProps {
  definition: WidgetDefinition;
  onAdd: (type: string) => void;
  onDragging: (type: string | null) => void;
}

/** Gallery card — click to add, or drag straight onto the canvas. */
function WidgetCard({ definition, onAdd, onDragging }: WidgetCardProps) {
  const Icon = definition.icon;
  const { w, h } = definition.defaultSize;

  return (
    <article
      draggable
      data-widget-drag-source
      onDragStart={(event) => {
        event.dataTransfer.setData(WIDGET_DRAG_MIME, definition.type);
        event.dataTransfer.setData('text/plain', definition.name);
        event.dataTransfer.effectAllowed = 'copy';
        onDragging(definition.type);
      }}
      onDragEnd={() => onDragging(null)}
      className={cn(
        'group/card flex cursor-grab flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 transition active:cursor-grabbing',
        'hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md',
        'dark:border-slate-700/70 dark:bg-slate-900 dark:hover:border-violet-500/50',
      )}
    >
      <div className="flex items-start gap-2.5">
        <IconChip tone={definition.accent}>
          <Icon className="h-4 w-4" />
        </IconChip>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{definition.name}</h4>
          <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">{definition.summary}</p>
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <Badge tone="slate">
            {w}×{h}
          </Badge>
          {definition.badge ? <Badge tone={definition.accent}>{definition.badge}</Badge> : null}
        </span>
        <Button
          size="sm"
          variant="secondary"
          icon={<PlusIcon className="h-3.5 w-3.5" />}
          onClick={() => onAdd(definition.type)}
        >
          Add
        </Button>
      </div>
    </article>
  );
}

/** Slide-over gallery of every registered widget. */
export function AddWidgetDrawer() {
  const open = useUiStore((state) => state.addWidgetOpen);
  const close = useUiStore((state) => state.closeAddWidget);
  const setDraggingType = useUiStore((state) => state.setDraggingType);
  const { addWidget } = useDashboardActions();
  const widgetCount = useDashboardStore((state) => state.widgets.length);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<WidgetCategory | 'all'>('all');

  const results = useMemo(() => searchWidgetDefinitions(query, category), [query, category]);
  const categories = useMemo(() => availableCategories(), []);

  return (
    <Drawer
      open={open}
      onClose={close}
      title="Add a widget"
      description="Drag a card onto the grid, or add it with a click."
      widthClassName="sm:max-w-lg"
      toolbar={
        <div className="space-y-2.5">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <TextInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search widgets…"
              aria-label="Search widgets"
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[{ id: 'all' as const, label: 'All' }, ...categories].map((entry) => {
              const active = category === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setCategory(entry.id as WidgetCategory | 'all')}
                  aria-pressed={active}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-semibold transition',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60',
                    active
                      ? 'bg-violet-600 text-accent-fg dark:bg-violet-500'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200',
                  )}
                >
                  {entry.label}
                </button>
              );
            })}
          </div>
        </div>
      }
      footer={
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {widgetCount} widget{widgetCount === 1 ? '' : 's'} on the canvas · drop position is respected when you drag.
        </p>
      }
    >
      {results.length === 0 ? (
        <EmptyState
          icon={<SearchIcon className="h-5 w-5" />}
          title="No widgets match"
          description="Try a different search term or clear the filters."
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setQuery('');
                setCategory('all');
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {results.map((definition) => (
            <WidgetCard
              key={definition.type}
              definition={definition}
              onDragging={setDraggingType}
              onAdd={(type) => {
                addWidget(type);
                close();
              }}
            />
          ))}
        </div>
      )}
    </Drawer>
  );
}
