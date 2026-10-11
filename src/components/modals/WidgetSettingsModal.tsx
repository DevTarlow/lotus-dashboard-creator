import { useState, type KeyboardEvent } from 'react';
import { CopyIcon, RefreshIcon, TrashIcon } from '@/components/icons';
import { Badge, Button, IconChip, Modal, TextInput } from '@/components/ui';
import { SettingsForm } from '@/components/forms/SettingsForm';
import { useDashboardStore } from '@/store/dashboardStore';
import { useToastStore } from '@/store/toastStore';
import { useUiStore } from '@/store/uiStore';
import type { StoredWidgetInstance } from '@/types';
import { getWidgetDefinition } from '@/widgets/registry';

interface BodyProps {
  widget: StoredWidgetInstance;
  onDone: () => void;
  onRemove: () => void;
}

/**
 * Modal contents. Mounted with `key={widget.id}`, so the title field initialises
 * from the selected widget without any prop→state synchronisation effect.
 */
function WidgetSettingsBody({ widget, onDone, onRemove }: BodyProps) {
  const renameWidget = useDashboardStore((state) => state.renameWidget);
  const updateWidgetConfig = useDashboardStore((state) => state.updateWidgetConfig);
  const resetWidgetConfig = useDashboardStore((state) => state.resetWidgetConfig);
  const duplicateWidget = useDashboardStore((state) => state.duplicateWidget);
  const notify = useToastStore((state) => state.success);

  const [draftTitle, setDraftTitle] = useState(widget.title);
  const definition = getWidgetDefinition(widget.type);
  const Icon = definition?.icon;

  const commitTitle = () => {
    if (draftTitle.trim() !== widget.title) renameWidget(widget.id, draftTitle);
  };

  return (
    <>
      <div className="space-y-5">
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700/70 dark:bg-slate-950/40">
          {Icon ? (
            <IconChip tone={definition?.accent ?? 'slate'}>
              <Icon className="h-4 w-4" />
            </IconChip>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {definition?.name ?? widget.type}
            </p>
            <p className="truncate text-[11px] text-slate-400 dark:text-slate-500">
              Added {new Date(widget.createdAt).toLocaleDateString()}
            </p>
          </div>
          {definition ? (
            <Badge tone={definition.accent}>{definition.category}</Badge>
          ) : (
            <Badge tone="amber">not included here</Badge>
          )}
        </div>

        <TextInput
          label="Widget title"
          value={draftTitle}
          maxLength={60}
          onChange={(event) => setDraftTitle(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitTitle();
            }
          }}
          placeholder={definition?.name ?? 'Widget'}
        />

        {definition ? (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Options</h3>
            <SettingsForm
              definition={definition}
              config={widget.config}
              onChange={(patch) => updateWidgetConfig(widget.id, patch)}
            />
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-3 text-xs text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/5 dark:text-amber-300">
            This widget isn't part of this copy of the app, so there is nothing to configure. Your saved content for it
            is kept.
          </p>
        )}
      </div>

      <footer className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
        <Button
          variant="ghost"
          icon={<CopyIcon className="h-4 w-4" />}
          onClick={() => {
            const id = duplicateWidget(widget.id);
            if (id) {
              notify('Widget duplicated', { description: 'The copy was placed next to the original.' });
              onDone();
            }
          }}
        >
          Duplicate widget
        </Button>
        <Button
          variant="ghost"
          icon={<RefreshIcon className="h-4 w-4" />}
          onClick={() => {
            resetWidgetConfig(widget.id);
            notify('Widget reset', { description: `${widget.title} is back to its default settings.` });
          }}
        >
          Reset this widget
        </Button>
        <Button variant="danger" icon={<TrashIcon className="h-4 w-4" />} onClick={onRemove}>
          Remove widget
        </Button>
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      </footer>
    </>
  );
}

/**
 * Settings modal for a single widget: rename, schema driven options and the
 * per-widget lifecycle actions.
 */
export function WidgetSettingsModal() {
  const settingsWidgetId = useUiStore((state) => state.settingsWidgetId);
  const closeSettings = useUiStore((state) => state.closeSettings);
  const requestDelete = useUiStore((state) => state.requestDelete);
  const widget = useDashboardStore((state) => state.widgets.find((entry) => entry.id === settingsWidgetId));

  if (!widget) return null;

  const definition = getWidgetDefinition(widget.type);

  return (
    <Modal
      open
      onClose={closeSettings}
      title={widget.title}
      description={definition?.summary ?? `Plugin “${widget.type}” is not installed.`}
      size="md"
    >
      <WidgetSettingsBody
        key={widget.id}
        widget={widget}
        onDone={closeSettings}
        onRemove={() => {
          closeSettings();
          requestDelete(widget.id);
        }}
      />
    </Modal>
  );
}
