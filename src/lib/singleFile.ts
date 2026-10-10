/**
 * Turning the running app into a self-contained dashboard file.
 *
 * A "single file" dashboard is the whole app — markup, styles, script and the
 * user's workspace — in one `.html` file that can be double-clicked, moved,
 * emailed or backed up. Two things make that work:
 *
 *   1. the production build inlines every asset (see `vite.config.ts`), and
 *   2. the running page can serialise *itself*.
 *
 * Serialising the live document rather than `fetch`-ing the original is
 * deliberate: `fetch()` of a `file://` URL is blocked by the browser, so a
 * dashboard opened from disk could never save itself otherwise.
 *
 * The snapshot is written through the DOM rather than by string surgery. Doing
 * it with `html.replace(/<\/body>/, …)` looks equivalent and is not: the minified
 * bundle sitting inside the document contains that literal sequence in its own
 * source, so the first match lands *inside the script* and corrupts it.
 */
import { APP_NAME, EXPORT_FILE_PREFIX } from '@/constants/app';
import { suggestedSlug } from '@/lib/document';
import { encodeEmbeddedState, EMBEDDED_ELEMENT_ID, type EmbeddedState } from '@/lib/embedded';

/**
 * Serialise the current document, with the workspace snapshot inside it.
 *
 * `#root` is emptied first: React owns that subtree, and baking in a copy of the
 * rendered markup would bloat the file and flash stale content before the script
 * takes over on the next open.
 */
export function capturePageHtml(doc: Document, state: EmbeddedState): string {
  const clone = doc.documentElement.cloneNode(true) as HTMLElement;

  clone.querySelector('#root')?.replaceChildren();

  // Replace any snapshot already in the page, otherwise add one. Either way this
  // is idempotent: saving repeatedly never stacks up copies.
  let holder = clone.querySelector(`#${EMBEDDED_ELEMENT_ID}`);
  if (!holder) {
    holder = clone.ownerDocument.createElement('script');
    holder.setAttribute('type', 'application/json');
    holder.id = EMBEDDED_ELEMENT_ID;
    (clone.querySelector('body') ?? clone).appendChild(holder);
  }
  holder.textContent = encodeEmbeddedState(state);

  const doctype = doc.doctype ? `<!doctype ${doc.doctype.name}>\n` : '<!doctype html>\n';
  return `${doctype}${clone.outerHTML}`;
}

/** Capture and embed in one step. */
export function serializeDashboardFile(doc: Document, state: EmbeddedState): string {
  return capturePageHtml(doc, state);
}

/**
 * File name for a saved dashboard.
 *
 * Deliberately undated: re-saving should overwrite the same file rather than
 * scatter `-2026-10-09` copies through the user's downloads.
 */
export function suggestedDashboardFileName(title: string): string {
  const slug = suggestedSlug(title);
  return `${EXPORT_FILE_PREFIX}${slug ? `-${slug}` : ''}.html`;
}

/** Human readable summary used in toasts and the save dialog. */
export function dashboardFileDescription(title: string): string {
  return `${APP_NAME} dashboard — ${title.trim() || 'Untitled'}`;
}
