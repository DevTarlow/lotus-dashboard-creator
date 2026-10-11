import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { CheckIcon, ExternalLinkIcon, GripIcon, LinksIcon, PencilIcon, PlusIcon, TrashIcon } from '@/components/icons';
import { Badge, Button, EmptyState, IconButton, TextInput } from '@/components/ui';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { cn, createId, moveItem } from '@/lib/utils';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';
import { displayHost, faviconUrl, initialsFor, isValidUrl, normalizeUrl } from './url';

export interface QuickLink {
  id: string;
  label: string;
  url: string;
}

export type LinksConfig = {
  links: QuickLink[];
  openInNewTab: boolean;
  showFavicons: boolean;
};

const DEFAULT_LINKS: QuickLink[] = [
  { id: 'link-hn', label: 'Hacker News', url: 'https://news.ycombinator.com' },
  { id: 'link-mdn', label: 'MDN', url: 'https://developer.mozilla.org' },
  { id: 'link-react', label: 'React', url: 'https://react.dev' },
  { id: 'link-gh', label: 'GitHub', url: 'https://github.com' },
];

const DEFAULT_LINKS_CONFIG: LinksConfig = {
  links: DEFAULT_LINKS,
  openInNewTab: true,
  showFavicons: true,
};

const SETTINGS: readonly SettingField[] = [
  { key: 'openInNewTab', label: 'Open in a new tab', type: 'switch' },
  { key: 'showFavicons', label: 'Show favicons', type: 'switch' },
];

/** Favicon with a graceful initial-chip fallback (offline, blocked, unknown host). */
function LinkIcon({ link, className }: { link: QuickLink; className?: string }) {
  // Remembering *which* source failed means no effect is needed to reset the
  // state when the URL changes.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = useMemo(() => faviconUrl(link.url), [link.url]);
  const failed = failedSrc !== null && failedSrc === src;

  const chip = (
    <span
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-violet-100 text-[10px] font-bold text-violet-700',
        'dark:bg-violet-500/15 dark:text-violet-300',
        className,
      )}
      aria-hidden="true"
    >
      {initialsFor(link.label, link.url)}
    </span>
  );

  if (failed || src === '') return chip;

  return (
    <img
      src={src}
      alt=""
      width={24}
      height={24}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
      className={cn('h-6 w-6 shrink-0 rounded-md bg-white object-contain dark:bg-slate-800', className)}
    />
  );
}

/** Bookmark launcher with inline editing. */
export function LinksWidget({ config, updateConfig }: WidgetProps<LinksConfig>) {
  const [editing, setEditing] = useState(false);
  /**
   * `null` means "mirror the stored config"; a value means "the user is editing".
   * Avoids prop→state syncing effects entirely (see the notes widget for the
   * same pattern).
   */
  const [draft, setDraft] = useState<QuickLink[] | null>(null);
  const links = draft ?? config.links;

  const commit = useDebouncedCallback((next: QuickLink[]) => updateConfig({ links: next }), 400);

  const applyDraft = (next: QuickLink[]) => {
    setDraft(next);
    commit.run(next);
  };

  const addLink = () => applyDraft([...links, { id: createId('link'), label: '', url: '' }]);

  const removeLink = (id: string) => applyDraft(links.filter((link) => link.id !== id));

  const patchLink = (id: string, patch: Partial<QuickLink>) =>
    applyDraft(links.map((link) => (link.id === id ? { ...link, ...patch } : link)));

  /* ------------------------------------------------------ drag to reorder */

  /** Id of the row currently being dragged, or `null` when idle. */
  const [dragId, setDragId] = useState<string | null>(null);
  /** Row elements, keyed by link id, used to work out the drop index. */
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  /** Order the gesture started from, so a no-op drag commits nothing. */
  const dragStart = useRef<readonly QuickLink[] | null>(null);
  /**
   * Working order for the gesture in progress.
   *
   * The pointer listeners live on `window` rather than the handle because live
   * reordering moves the handle's row in the DOM, and moving a node silently
   * drops its pointer capture — which would strand the gesture after the first
   * swap and lose the new order.
   */
  const dragOrder = useRef<readonly QuickLink[] | null>(null);

  const registerRow = (id: string, element: HTMLDivElement | null) => {
    if (element) rowRefs.current.set(id, element);
    else rowRefs.current.delete(id);
  };

  /** Index of the row nearest to a viewport Y coordinate. */
  const indexAtPoint = (order: readonly QuickLink[], clientY: number): number | null => {
    let bestIndex: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < order.length; index += 1) {
      const element = rowRefs.current.get(order[index].id);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      const distance =
        clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    return bestIndex;
  };

  const beginDrag = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (links.length < 2) return;
    // Keep the OS from starting a text selection or a scroll on touch.
    event.preventDefault();
    dragStart.current = links;
    dragOrder.current = links;
    setDragId(id);
  };

  useEffect(() => {
    if (dragId === null) return undefined;
    const draggedId = dragId;

    const onMove = (event: globalThis.PointerEvent) => {
      const order = dragOrder.current;
      if (!order) return;
      const target = indexAtPoint(order, event.clientY);
      if (target === null) return;
      const from = order.findIndex((link) => link.id === draggedId);
      if (from === -1 || from === target) return;
      const next = moveItem(order, from, target);
      dragOrder.current = next;
      setDraft(next);
    };

    const onFinish = () => {
      const next = dragOrder.current;
      const start = dragStart.current;
      dragOrder.current = null;
      dragStart.current = null;
      setDragId(null);
      if (!next || !start) return;
      // Persist once, at the end of the gesture, and only when the order moved.
      const moved = next.some((link, index) => link.id !== start[index]?.id);
      if (!moved) return;
      commit.cancel();
      updateConfig({ links: [...next] });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onFinish);
    window.addEventListener('pointercancel', onFinish);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onFinish);
      window.removeEventListener('pointercancel', onFinish);
    };
    // `commit`/`updateConfig`/helpers are recreated per render; the gesture reads
    // all mutable state from refs, so only the active id needs to re-subscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragId]);

  /** Keyboard equivalent of dragging, via the arrow keys on the handle. */
  const reorderWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (delta === 0) return;
    const target = index + delta;
    if (target < 0 || target >= links.length) return;
    event.preventDefault();
    applyDraft(moveItem(links, index, target));
  };

  const finishEditing = () => {
    // Drop rows the user left completely empty, then write once.
    const cleaned = links.filter((link) => normalizeUrl(link.url) !== '');
    commit.cancel();
    setDraft(null);
    if (cleaned.length !== config.links.length || cleaned.some((link, index) => link !== config.links[index])) {
      updateConfig({ links: cleaned });
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex h-full flex-col gap-2">
        {links.length > 1 ? (
          <p className="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
            Drag the handle — or focus it and use ↑ ↓ — to reorder.
          </p>
        ) : null}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
          {links.map((link, index) => {
            const invalid = link.url.trim() !== '' && !isValidUrl(link.url);
            const dragging = dragId === link.id;
            return (
              <div
                key={link.id}
                ref={(element) => registerRow(link.id, element)}
                className={cn(
                  'flex items-center gap-2 rounded-lg transition-colors',
                  dragging && 'bg-violet-50/70 ring-1 ring-violet-300 dark:bg-violet-500/10 dark:ring-violet-500/40',
                )}
              >
                <IconButton
                  label={`Reorder ${link.label.trim() || 'link'}`}
                  size="icon-sm"
                  variant="ghost"
                  icon={<GripIcon className="h-3.5 w-3.5" />}
                  className="shrink-0 cursor-grab touch-none text-slate-400 active:cursor-grabbing dark:text-slate-500"
                  onPointerDown={(event) => beginDrag(event, link.id)}
                  onKeyDown={(event) => reorderWithKeyboard(event, index)}
                />
                <LinkIcon link={link} />
                <TextInput
                  value={link.label}
                  placeholder="Label"
                  aria-label="Link label"
                  onChange={(event) => patchLink(link.id, { label: event.target.value })}
                  className="h-8 w-24 shrink-0 px-2 py-1 text-xs sm:w-28"
                />
                <TextInput
                  value={link.url}
                  placeholder="example.com"
                  aria-label="Link URL"
                  onChange={(event) => patchLink(link.id, { url: event.target.value })}
                  className={cn('h-8 px-2 py-1 text-xs', invalid && 'border-rose-400 focus:border-rose-400')}
                />
                <IconButton
                  label="Remove link"
                  size="icon-sm"
                  variant="danger"
                  icon={<TrashIcon className="h-3.5 w-3.5" />}
                  onClick={() => removeLink(link.id)}
                />
              </div>
            );
          })}
          {links.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-400 dark:text-slate-500">No links yet.</p>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
          <Button size="sm" variant="ghost" icon={<PlusIcon className="h-3.5 w-3.5" />} onClick={addLink}>
            Add link
          </Button>
          <Button size="sm" variant="primary" icon={<CheckIcon className="h-3.5 w-3.5" />} onClick={finishEditing}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Badge tone="violet">{links.length} links</Badge>
        <Button size="sm" variant="ghost" icon={<PencilIcon className="h-3.5 w-3.5" />} onClick={() => setEditing(true)}>
          Edit
        </Button>
      </div>

      {links.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<LinksIcon className="h-4 w-4" />}
          title="No bookmarks yet"
          description="Add the sites you open every day."
          action={
            <Button size="sm" variant="primary" icon={<PlusIcon className="h-3.5 w-3.5" />} onClick={() => setEditing(true)}>
              Add a link
            </Button>
          }
        />
      ) : (
        <ul className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] content-start gap-2 overflow-y-auto pr-0.5">
          {links.map((link) => {
            const href = normalizeUrl(link.url);
            const host = displayHost(link.url);
            const label = link.label.trim() || host || 'Untitled link';
            return (
              <li key={link.id}>
                <a
                  href={href || undefined}
                  target={config.openInNewTab ? '_blank' : undefined}
                  rel="noreferrer noopener"
                  className={cn(
                    'group/link flex h-14 items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-2.5 transition',
                    'hover:-translate-y-0.5 hover:border-violet-300 hover:bg-white hover:shadow-md dark:border-slate-700/70 dark:bg-slate-900/60',
                    'dark:hover:border-violet-500/50 dark:hover:bg-slate-900',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60',
                    href === '' && 'pointer-events-none opacity-50',
                  )}
                  title={href || 'Invalid URL'}
                >
                  {config.showFavicons ? <LinkIcon link={link} /> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {label}
                    </span>
                    <span className="block truncate text-[10px] text-slate-400 dark:text-slate-500">
                      {host || 'invalid url'}
                    </span>
                  </span>
                  <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0 text-slate-300 opacity-0 transition group-hover/link:opacity-100 dark:text-slate-600" />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export const linksWidget = defineWidget<LinksConfig>({
  type: 'links',
  name: 'Quick links',
  summary: 'A launcher for the sites you use most.',
  category: 'productivity',
  keywords: ['bookmarks', 'links', 'launcher', 'shortcuts', 'favicon'],
  icon: LinksIcon,
  accent: 'emerald',
  defaultSize: { w: 4, h: 5, minW: 2, minH: 3 },
  defaultConfig: DEFAULT_LINKS_CONFIG,
  settings: SETTINGS,
  summarize: (config) => `${config.links.length} bookmark${config.links.length === 1 ? '' : 's'}`,
  component: LinksWidget,
});
