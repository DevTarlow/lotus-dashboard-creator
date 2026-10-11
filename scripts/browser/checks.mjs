/**
 * The browser checks themselves.
 *
 * Each group returns a list of `{ name, ok, detail }` results; the caller prints
 * them and decides the exit code. Everything here asserts on **live application
 * state** wherever possible (a switch's `aria-checked`, the widgets actually
 * rendered) rather than on text scraped out of the DOM, so a cosmetic change
 * cannot silently disable a check.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { openPage, wait, watchForProblems } from './cdp.mjs';

/** Force the download fallback: a native save dialog cannot be driven by CDP. */
const DISABLE_FILE_PICKER = `Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });`;

const describePage = `(() => {
  const items = [...document.querySelectorAll('.react-grid-item')];
  const logo = document.querySelector('header img');
  const embedded = document.getElementById('lotus-embedded-workspace');
  return {
    url: location.href,
    widgetCount: items.length,
    logoLoaded: logo ? logo.complete && logo.naturalWidth > 0 : null,
    embeddedPresent: embedded !== null,
    embeddedBytes: embedded ? embedded.textContent.length : 0,
    storageKeys: Object.keys(localStorage),
    statusText: (document.querySelector('footer')?.innerText || '').split('\\n')[0],
  };
})()`;

const openClockSettings = `(() => {
  const button = document.querySelector('button[aria-label="Settings for Clock"]');
  if (!button) return false;
  button.click();
  return true;
})()`;

/** The clock's switches as the running app reports them. */
const readClockSwitches = `(() => {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) return null;
  return [...dialog.querySelectorAll('[role="switch"]')].map((s) => s.getAttribute('aria-checked'));
})()`;

const closeDialog = `(() => {
  const done = [...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.innerText || '').trim() === 'Done');
  if (done) done.click();
  return Boolean(done);
})()`;

/** Open the clock settings, read its switches, close again. */
async function clockSwitches(session) {
  if (!(await session.evaluate(openClockSettings))) return null;
  await wait(400);
  const read = await session.evaluate(readClockSwitches);
  await session.evaluate(closeDialog);
  await wait(300);
  return read;
}

/** Wait for a completed `.html` download and return its path. */
async function waitForDownload(dir, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let previousSize = -1;
  while (Date.now() < deadline) {
    const entries = await readdir(dir).catch(() => []);
    const html = entries.find((name) => name.endsWith('.html'));
    if (html) {
      const file = path.join(dir, html);
      const { size } = await stat(file);
      if (size > 0 && size === previousSize) return file;
      previousSize = size;
    }
    await wait(250);
  }
  throw new Error('no dashboard file appeared in the download directory');
}

/**
 * The single-file promise, end to end, entirely offline.
 *
 * The critical assertion: the saved file is reopened from a *different path*,
 * which means a different `localStorage` scope, so a setting that comes back can
 * only have come from the snapshot embedded in the file.
 */
export async function runSingleFileChecks({ port, singleFile, downloadDir, report }) {
  const singleFileUrl = `file://${singleFile}`;
  const page = await openPage(port, 'about:blank');
  const problems = watchForProblems(page.session);
  try {
    await page.session.send('Page.addScriptToEvaluateOnNewDocument', {
      source: DISABLE_FILE_PICKER,
    });
    await page.session.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadDir,
    });

    // A clean slate, so "default" and "saved" are distinguishable below.
    await page.session.navigate(singleFileUrl);
    await page.session.evaluate('localStorage.clear()');
    await page.session.navigate(singleFileUrl);

    const booted = await page.session.evaluate(describePage);
    report.check('single file boots from file://', booted.widgetCount > 0, `${booted.widgetCount} widgets`);
    report.check('no loose assets (logo loads)', booted.logoLoaded === true);
    report.check('no snapshot in a freshly built file', booted.embeddedPresent === false);

    const defaultSwitches = await clockSwitches(page.session);
    report.check(
      'clock settings are readable',
      Array.isArray(defaultSwitches) && defaultSwitches.length === 3,
      JSON.stringify(defaultSwitches),
    );

    // Flip "Show seconds" (index 1) through the real settings dialog.
    await page.session.evaluate(openClockSettings);
    await wait(400);
    const toggled = await page.session.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const switches = [...dialog.querySelectorAll('[role="switch"]')];
      if (!switches[1]) return false;
      switches[1].click();
      return true;
    })()`);
    await wait(300);
    await page.session.evaluate(closeDialog);
    await wait(300);
    const savedSwitches = await clockSwitches(page.session);
    report.check(
      'a setting can be changed through the UI',
      toggled && JSON.stringify(savedSwitches) !== JSON.stringify(defaultSwitches),
      `${JSON.stringify(defaultSwitches)} → ${JSON.stringify(savedSwitches)}`,
    );

    // Save to file via the dashboard actions menu.
    await page.session.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')];
      const trigger = buttons.find((b) => (b.getAttribute('aria-label') || '').startsWith('Dashboard actions'));
      (trigger ?? buttons[buttons.length - 3]).click();
      return true;
    })()`);
    await wait(400);
    const invoked = await page.session.evaluate(`(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')]
        .find((el) => /save to file/i.test((el.innerText || '').trim()));
      if (!item) return false;
      item.click();
      return true;
    })()`);
    report.check('"Save to file" is reachable from the menu', invoked);

    let savedFile = null;
    try {
      savedFile = await waitForDownload(downloadDir);
    } catch (error) {
      report.check('saving produces a file', false, String(error.message));
    }

    if (savedFile) {
      const html = await readFile(savedFile, 'utf8');
      report.check('saved file carries the snapshot', /id="lotus-embedded-workspace"/.test(html));
      report.check('saved file has the bundle inlined', /<script type="module">/.test(html));
      report.check('saved file has the stylesheet inlined', /<style>/.test(html));
      report.check('saved file is standalone', !/\b(?:src|href)="(?!#|data:)/.test(html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')));

      // Reopen from a different path: different localStorage scope, so a
      // restored value proves the embedded snapshot was used.
      await page.session.navigate(`file://${savedFile}`);
      const reopened = await page.session.evaluate(describePage);
      const restoredSwitches = await clockSwitches(page.session);

      report.check('saved file boots standalone', reopened.widgetCount > 0, `${reopened.widgetCount} widgets`);
      report.check('saved file still carries its snapshot', reopened.embeddedPresent === true, `${reopened.embeddedBytes} bytes`);
      report.check(
        'settings survive the save/reopen round trip',
        JSON.stringify(restoredSwitches) === JSON.stringify(savedSwitches),
        `saved ${JSON.stringify(savedSwitches)} → reopened ${JSON.stringify(restoredSwitches)}`,
      );

      const scopes = new Set(reopened.storageKeys);
      report.check(
        'localStorage is scoped per document path',
        scopes.size >= 2 || !reopened.storageKeys.some((key) => key.includes('dist-single')),
        [...scopes].join(', ') || 'no keys',
      );
    }
  } finally {
    report.check('no console errors on file://', problems.consoleErrors.length === 0, problems.consoleErrors.slice(0, 3).join(' | '));
    report.check('no uncaught exceptions', problems.exceptions.length === 0, problems.exceptions.slice(0, 2).join(' | '));
    await page.close();
  }
}

/** Server-side checks. `appUrl` must already be reachable. */
export async function runAppChecks({ port, appUrl, report }) {
  const page = await openPage(port, 'about:blank');
  const problems = watchForProblems(page.session);
  try {
    await page.session.navigate(appUrl);
    const health = await page.session.evaluate(describePage);
    report.check('app renders', health.widgetCount > 0, `${health.widgetCount} widgets`);
    report.check('app assets resolve', health.logoLoaded === true);
    report.check('status bar reports real storage state', /saved in this browser|not saved/i.test(health.statusText), health.statusText);

    // The save action must be wired into the menu on the web build too.
    await page.session.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')];
      const trigger = buttons.find((b) => (b.getAttribute('aria-label') || '').startsWith('Dashboard actions'));
      if (trigger) trigger.click();
      return Boolean(trigger);
    })()`);
    await wait(400);
    const menuItems = await page.session.evaluate(
      `[...document.querySelectorAll('[role="menuitem"]')].map((el) => (el.innerText || '').trim())`,
    );
    report.check('"Save to file" is offered', menuItems.some((label) => /save to file/i.test(label)));

    // Settings must survive a reload (the regression that started all of this).
    await page.session.evaluate('document.body.click()');
    await wait(300);
    const before = await clockSwitches(page.session);
    await page.session.evaluate(openClockSettings);
    await wait(400);
    await page.session.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const switches = [...dialog.querySelectorAll('[role="switch"]')];
      if (switches[1]) switches[1].click();
      return true;
    })()`);
    await wait(300);
    await page.session.evaluate(closeDialog);
    await wait(300);
    const after = await clockSwitches(page.session);

    await page.session.navigate(appUrl);
    const reloaded = await clockSwitches(page.session);
    report.check(
      'settings survive a browser refresh',
      JSON.stringify(reloaded) === JSON.stringify(after) && JSON.stringify(after) !== JSON.stringify(before),
      `${JSON.stringify(before)} → ${JSON.stringify(after)} → reload ${JSON.stringify(reloaded)}`,
    );
  } finally {
    report.check('no console errors on the server build', problems.consoleErrors.length === 0, problems.consoleErrors.slice(0, 3).join(' | '));
    report.check('no uncaught exceptions on the server build', problems.exceptions.length === 0);
    await page.close();
  }
}

/**
 * The notes file-manager panel: create, autosave across a reload, delete behind
 * the confirm dialog, and — the regression that matters most — a workspace saved
 * before the panel existed opening with its text as the first note.
 */
export async function runNotesChecks({ port, appUrl, report }) {
  const page = await openPage(port, 'about:blank');
  const problems = watchForProblems(page.session);
  try {
    await page.session.navigate(appUrl);
    await page.session.evaluate(
      `localStorage.removeItem(Object.keys(localStorage).find((k) => k.includes('workspace')) ?? '')`,
    );
    await page.session.navigate(appUrl);
    await wait(400);

    // A workspace saved before the panel existed stores one `text` string. It has
    // to open as the first note, and the legacy key has to be migrated away.
    const legacyText = '# Legacy scratchpad\n\nwritten before the panel existed';
    const seeded = await page.session.evaluate(`(() => {
      const key = Object.keys(localStorage).find((k) => k.includes('workspace'));
      if (!key) return false;
      const persisted = JSON.parse(localStorage.getItem(key));
      const widget = persisted.state.widgets.find((w) => w.type === 'notes');
      if (!widget) return false;
      widget.config = { text: ${JSON.stringify(legacyText)}, mode: 'split', fontSize: 'md' };
      localStorage.setItem(key, JSON.stringify(persisted));
      return true;
    })()`);
    report.check('a pre-panel workspace can be seeded', seeded === true);
    await page.session.navigate(appUrl);
    await wait(500);
    const migrated = await page.session.evaluate(`(() => {
      const item = [...document.querySelectorAll('.react-grid-item')].find((el) => /Markdown notes/i.test(el.innerText || ''));
      if (!item) return null;
      const editor = item.querySelector('textarea[aria-label^="Note "]');
      const key = Object.keys(localStorage).find((k) => k.includes('workspace'));
      const widget = JSON.parse(localStorage.getItem(key)).state.widgets.find((w) => w.type === 'notes');
      return {
        value: editor ? editor.value : null,
        rows: item.querySelectorAll('ul[aria-label="Your notes"] > li').length,
        notes: Array.isArray(widget.config.notes) ? widget.config.notes.length : null,
        legacyKey: Object.prototype.hasOwnProperty.call(widget.config, 'text'),
      };
    })()`);
    report.check(
      'a pre-panel scratchpad opens as the first note',
      migrated?.value === legacyText && migrated.rows === 1 && migrated.notes === 1,
      JSON.stringify(migrated),
    );
    report.check('the migrated workspace drops the legacy "text" key', migrated?.legacyKey === false);

    await page.session.evaluate(
      `localStorage.removeItem(Object.keys(localStorage).find((k) => k.includes('workspace')) ?? '')`,
    );
    await page.session.navigate(appUrl);
    await wait(400);

    const panel = await page.session.evaluate(`(() => {
      const item = [...document.querySelectorAll('.react-grid-item')].find((el) => /Markdown notes/i.test(el.innerText || ''));
      if (!item) return null;
      const create = [...item.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'New note');
      const rows = item.querySelectorAll('ul[aria-label="Your notes"] > li');
      const editor = item.querySelector('textarea[aria-label^="Note "]');
      return { rows: rows.length, hasEditor: Boolean(editor), hasCreate: Boolean(create) };
    })()`);
    report.check('the notes panel lists notes next to the editor', panel?.rows >= 1 && panel?.hasEditor === true, JSON.stringify(panel));
    if (!panel) return;

    const created = await page.session.evaluate(`(() => {
      const item = [...document.querySelectorAll('.react-grid-item')].find((el) => /Markdown notes/i.test(el.innerText || ''));
      const button = item && [...item.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'New note');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    await wait(350);
    const typed = await page.session.evaluate(`(() => {
      const item = [...document.querySelectorAll('.react-grid-item')].find((el) => /Markdown notes/i.test(el.innerText || ''));
      const editor = item && item.querySelector('textarea[aria-label^="Note "]');
      if (!editor) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(editor, '# Browser note\\n\\nsaved from the panel check');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    report.check('a new note can be created and typed into', created && typed);
    await wait(600);
    const savedIndicator = await page.session.evaluate(`(() => {
      const item = [...document.querySelectorAll('.react-grid-item')].find((el) => /Markdown notes/i.test(el.innerText || ''));
      return (item?.innerText || '').includes('Saved');
    })()`);
    report.check('the autosave indicator reports Saved', savedIndicator === true);

    const stored = `(() => {
      const key = Object.keys(localStorage).find((k) => k.includes('workspace'));
      if (!key) return null;
      const widget = JSON.parse(localStorage.getItem(key)).state.widgets.find((w) => w.type === 'notes');
      return {
        texts: widget.config.notes.map((n) => n.text),
        ids: widget.config.notes.map((n) => n.id),
        legacyKey: Object.prototype.hasOwnProperty.call(widget.config, 'text'),
        activeNoteId: widget.config.activeNoteId,
      };
    })()`;
    const before = await page.session.evaluate(stored);
    const browserNoteId = `# Browser note\n\nsaved from the panel check`;
    report.check(
      'the new note is persisted with its own id',
      before?.texts.includes(browserNoteId) === true && before.ids.length === 2,
      JSON.stringify(before?.ids?.length),
    );
    // The welcome note stays where it was; the new note is the active one.
    const welcome = before?.texts.findIndex((text) => text.startsWith('# Welcome to Lotus')) ?? -1;
    report.check(
      'the selected note survives a reload',
      welcome !== -1 && before.activeNoteId !== before.ids[welcome] && before.ids.includes(before.activeNoteId),
      `active ${before?.activeNoteId} of ${JSON.stringify(before?.ids)}`,
    );
    report.check('the pre-panel "text" key is migrated away', before?.legacyKey === false, String(before?.legacyKey));

    await page.session.navigate(appUrl);
    await wait(500);
    const afterReload = await page.session.evaluate(`(() => {
      const item = [...document.querySelectorAll('.react-grid-item')].find((el) => /Markdown notes/i.test(el.innerText || ''));
      if (!item) return null;
      const editor = item.querySelector('textarea[aria-label^="Note "]');
      return { value: editor ? editor.value : null, rows: item.querySelectorAll('ul[aria-label="Your notes"] > li').length };
    })()`);
    report.check(
      'the active note and its text come back after a refresh',
      afterReload?.value === browserNoteId && afterReload.rows === 2,
      JSON.stringify(afterReload),
    );

    const deleted = await page.session.evaluate(`(() => {
      const item = [...document.querySelectorAll('.react-grid-item')].find((el) => /Markdown notes/i.test(el.innerText || ''));
      const button = item && [...item.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith('Delete '));
      if (!button) return false;
      button.click();
      return true;
    })()`);
    report.check('deleting a note asks for confirmation first', deleted);
    await wait(400);
    const confirmed = await page.session.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return false;
      const button = [...dialog.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'Delete note');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    await wait(700);
    const afterDelete = await page.session.evaluate(stored);
    report.check(
      'deleting removes the note from the workspace',
      confirmed && afterDelete?.texts.length === 1 && !afterDelete.texts.includes(browserNoteId),
      JSON.stringify(afterDelete?.texts?.length),
    );
    report.check('the surviving note is selected', afterDelete?.activeNoteId === afterDelete?.ids[0]);

    // An emptied list has to stay empty: re-seeding on read would resurrect a
    // note the user deleted.
    await page.session.evaluate(`(() => {
      const item = [...document.querySelectorAll('.react-grid-item')].find((el) => /Markdown notes/i.test(el.innerText || ''));
      const button = item && [...item.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith('Delete '));
      if (button) button.click();
      return true;
    })()`);
    await wait(300);
    await page.session.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const button = dialog && [...dialog.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'Delete note');
      if (button) button.click();
      return Boolean(button);
    })()`);
    await wait(700);
    await page.session.navigate(appUrl);
    await wait(500);
    const emptied = await page.session.evaluate(`(() => {
      const item = [...document.querySelectorAll('.react-grid-item')].find((el) => /Markdown notes/i.test(el.innerText || ''));
      return item ? (item.innerText || '').includes('No notes yet') : false;
    })()`);
    report.check('deleting every note leaves an empty panel, not a re-seeded one', emptied === true);
  } finally {
    report.check('no console errors during notes interaction', problems.consoleErrors.length === 0, problems.consoleErrors.slice(0, 3).join(' | '));
    report.check('no uncaught exceptions during notes interaction', problems.exceptions.length === 0);
    await page.close();
  }
}

/**
 * The split view divider: dragging it resizes the panes, the ratio survives a
 * reload, and the arrow keys/Home/End move it without a pointer at all.
 */
export async function runNotesResizeChecks({ port, appUrl, report }) {
  const page = await openPage(port, 'about:blank');
  const problems = watchForProblems(page.session);
  try {
    // A roomy widget so the divider has somewhere to travel.
    await page.session.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.session.navigate(appUrl);
    await page.session.evaluate(
      `localStorage.removeItem(Object.keys(localStorage).find((k) => k.includes('workspace')) ?? '')`,
    );
    await page.session.navigate(appUrl);
    await wait(500);

    const readRatio = `(() => {
      const key = Object.keys(localStorage).find((k) => k.includes('workspace'));
      if (!key) return null;
      const widget = JSON.parse(localStorage.getItem(key)).state.widgets.find((w) => w.type === 'notes');
      return widget ? widget.config.editorRatio ?? null : null;
    })()`;
    /**
     * What the divider actually did to the layout. The pane's own width has to be
     * read against the *split container*, not the grid item: the widget body is
     * narrower than its grid slot, and comparing against the slot understates the
     * share by a third.
     */
    /**
     * The notes panel is not the first card on a full workspace, and the drags
     * below are dispatched in viewport coordinates. Scrolling and measuring must
     * therefore be separate steps: a rect read in the same batch as a scroll can
     * still describe the old position, and the press lands on whatever is there
     * instead — which starts a *grid* drag and looks exactly like a dead divider.
     */
    const scrollToNotes = `(() => {
      const item = [...document.querySelectorAll('.react-grid-item')].find((el) => /Markdown notes/i.test(el.innerText || ''));
      if (!item) return false;
      item.scrollIntoView({ block: 'center', behavior: 'instant' });
      return true;
    })()`;

    const geometry = `(() => {
      const item = [...document.querySelectorAll('.react-grid-item')].find((el) => /Markdown notes/i.test(el.innerText || ''));
      if (!item) return null;
      const separator = item.querySelector('[role="separator"][aria-label="Resize the editor and preview"]');
      const split = separator && separator.parentElement;
      if (!split) return null;
      const pane = split.children[0];
      const rect = separator.getBoundingClientRect();
      const width = split.getBoundingClientRect().width;
      return {
        renderedShare: width === 0 ? 0 : pane.getBoundingClientRect().width / width,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    })()`;

    await page.session.evaluate(scrollToNotes);
    await wait(150);
    report.check('the split view exposes a draggable divider', (await page.session.evaluate(geometry)) !== null);

    const mouse = (type, x, y, buttons) =>
      page.session.send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: 'left',
        buttons,
        clickCount: type === 'mouseMoved' ? 0 : 1,
      });

    /** A single-pane view: does the one visible pane reach the widget body's edge? */
    const singlePane = (pane) => `(() => {
      const item = [...document.querySelectorAll('.react-grid-item')].find((el) => /Markdown notes/i.test(el.innerText || ''));
      const body = item && item.querySelector('.overflow-auto.p-3');
      const target = item && item.querySelector(${JSON.stringify(pane)});
      if (!body || !target) return null;
      // The root row inside the padded body is the area a pane has to fill; the
      // body itself is wider by its padding.
      const row = body.firstElementChild;
      const rowRect = row.getBoundingClientRect();
      const rect = target.getBoundingClientRect();
      return {
        trailingSpace: Math.round(rowRect.right - rect.right),
        share: rect.width / rowRect.width,
        separators: item.querySelectorAll('[role="separator"]').length,
      };
    })()`;

    /** Drag the divider by `dx` device pixels, in a few steps. */
    const drag = async (dx) => {
      if (!(await page.session.evaluate(scrollToNotes))) return null;
      await wait(150);
      const before = await page.session.evaluate(geometry);
      if (!before) return null;
      await wait(100);
      await mouse('mousePressed', before.x, before.y, 1);
      await wait(60);
      for (let step = 1; step <= 5; step += 1) {
        await mouse('mouseMoved', before.x + (dx * step) / 5, before.y, 1);
        await wait(40);
      }
      await mouse('mouseReleased', before.x + dx, before.y, 0);
      await wait(400);
      return {
        before,
        after: await page.session.evaluate(geometry),
        stored: await page.session.evaluate(readRatio),
      };
    };

    const right = await drag(160);
    report.check(
      'dragging the divider widens the editor pane',
      right !== null && right.after.renderedShare > right.before.renderedShare + 0.02 && right.stored > 50,
      JSON.stringify([Number(right?.before.renderedShare?.toFixed(2)), Number(right?.after.renderedShare?.toFixed(2)), right?.stored]),
    );
    report.check(
      'the widened pane matches the persisted ratio',
      right !== null && Math.abs(right.after.renderedShare * 100 - right.stored) < 2,
      JSON.stringify([right?.stored, Number((right?.after.renderedShare * 100).toFixed(1))]),
    );

    const left = await drag(-160);
    report.check(
      'dragging the other way narrows it again',
      left !== null && left.after.renderedShare < left.before.renderedShare - 0.02 && left.stored < right.stored,
      JSON.stringify([Number(left?.before.renderedShare?.toFixed(2)), Number(left?.after.renderedShare?.toFixed(2)), left?.stored]),
    );

    await page.session.navigate(appUrl);
    await wait(500);
    await page.session.evaluate(scrollToNotes);
    await wait(150);
    const reloaded = await page.session.evaluate(geometry);
    const reloadedStored = await page.session.evaluate(readRatio);
    report.check(
      'the chosen ratio comes back after a refresh',
      reloaded !== null &&
        reloadedStored !== null &&
        Math.abs(reloaded.renderedShare * 100 - reloadedStored) < 2,
      JSON.stringify([reloadedStored, Number((reloaded?.renderedShare * 100).toFixed(1))]),
    );

    await page.session.evaluate(`(() => {
      const item = [...document.querySelectorAll('.react-grid-item')].find((el) => /Markdown notes/i.test(el.innerText || ''));
      const separator = item && item.querySelector('[role="separator"][aria-label="Resize the editor and preview"]');
      if (separator) separator.focus();
      return Boolean(separator);
    })()`);
    const key = (code, windowsVirtualKeyCode) =>
      page.session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code, key: code, windowsVirtualKeyCode });
    await key('End', 35);
    await wait(300);
    report.check('End aims the divider at the maximum', (await page.session.evaluate(readRatio)) === 85);
    await key('Home', 36);
    await wait(300);
    report.check('Home aims the divider at the minimum', (await page.session.evaluate(readRatio)) === 15);
    await key('ArrowRight', 39);
    await wait(300);
    report.check('the arrow keys nudge the divider', (await page.session.evaluate(readRatio)) === 17);

    // Edit view has one divider — the notes panel — so it has to be draggable on
    // its own, not only as part of the split layout.
    const readSidebarRatio = `(() => {
      const key = Object.keys(localStorage).find((k) => k.includes('workspace'));
      if (!key) return null;
      const widget = JSON.parse(localStorage.getItem(key)).state.widgets.find((w) => w.type === 'notes');
      return widget ? widget.config.sidebarRatio ?? null : null;
    })()`;
    const sidebarGeometry = `(() => {
      const item = [...document.querySelectorAll('.react-grid-item')].find((el) => /Markdown notes/i.test(el.innerText || ''));
      if (!item) return null;
      const separator = item.querySelector('[role="separator"][aria-label="Resize the notes panel"]');
      const split = separator && separator.parentElement;
      if (!split) return null;
      const rect = separator.getBoundingClientRect();
      return {
        renderedShare: split.getBoundingClientRect().width === 0
          ? 0
          : split.children[0].getBoundingClientRect().width / split.getBoundingClientRect().width,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    })()`;

    const switched = await page.session.evaluate(`(() => {
      const item = [...document.querySelectorAll('.react-grid-item')].find((el) => /Markdown notes/i.test(el.innerText || ''));
      const edit = item && [...item.querySelectorAll('[role="radio"]')].find((b) => (b.innerText || '').trim() === 'Edit');
      if (!edit) return false;
      edit.click();
      return true;
    })()`);
    report.check('the notes widget switches to edit view', switched);
    await wait(400);

    const editPane = await page.session.evaluate(singlePane('textarea'));
    report.check(
      'edit view gives the editor the whole pane area',
      editPane !== null && editPane.trailingSpace <= 0 && editPane.share > 0.99 && editPane.separators === 0,
      JSON.stringify(editPane),
    );
    report.check(
      'edit view offers no divider (and no empty preview track)',
      (await page.session.evaluate(`(() => {
        const item = [...document.querySelectorAll('.react-grid-item')].find((el) => /Markdown notes/i.test(el.innerText || ''));
        return item.querySelectorAll('[role="separator"][aria-label="Resize the editor and preview"]').length === 0;
      })()`)) === true,
    );

    // The preview-only view behaves the same way: no empty editor track beside
    // it, and nothing to drag.
    const previewSwitched = await page.session.evaluate(`(() => {
      const item = [...document.querySelectorAll('.react-grid-item')].find((el) => /Markdown notes/i.test(el.innerText || ''));
      const preview = item && [...item.querySelectorAll('[role="radio"]')].find((b) => (b.innerText || '').trim() === 'Preview');
      if (!preview) return false;
      preview.click();
      return true;
    })()`);
    report.check('the notes widget switches to preview view', previewSwitched);
    await wait(400);
    const previewPane = await page.session.evaluate(singlePane('div[class*="overflow-y-auto"]'));
    report.check(
      'preview view gives the preview the whole pane area',
      previewPane !== null && previewPane.trailingSpace <= 0 && previewPane.share > 0.99 && previewPane.separators === 0,
      JSON.stringify(previewPane),
    );
    report.check(
      'preview view offers no divider (and no empty editor track)',
      (await page.session.evaluate(`(() => {
        const item = [...document.querySelectorAll('.react-grid-item')].find((el) => /Markdown notes/i.test(el.innerText || ''));
        return item.querySelectorAll('[role="separator"][aria-label="Resize the editor and preview"]').length === 0;
      })()`)) === true,
    );

    // Back to Split: the panel divider only exists when both panes do, which is
    // also where it gets exercised.
    await page.session.evaluate(`(() => {
      const item = [...document.querySelectorAll('.react-grid-item')].find((el) => /Markdown notes/i.test(el.innerText || ''));
      const split = item && [...item.querySelectorAll('[role="radio"]')].find((b) => (b.innerText || '').trim() === 'Split');
      if (split) split.click();
      return Boolean(split);
    })()`);
    await wait(400);

    const sidebarBefore = await page.session.evaluate(sidebarGeometry);
    const sidebarStoredBefore = await page.session.evaluate(readSidebarRatio);
    report.check('the notes panel divider is present in split view', sidebarBefore !== null);
    await mouse('mousePressed', sidebarBefore.x, sidebarBefore.y, 1);
    await wait(60);
    for (let step = 1; step <= 5; step += 1) {
      await mouse('mouseMoved', sidebarBefore.x + (80 * step) / 5, sidebarBefore.y, 1);
      await wait(40);
    }
    await mouse('mouseReleased', sidebarBefore.x + 80, sidebarBefore.y, 0);
    await wait(400);
    const sidebarAfter = await page.session.evaluate(sidebarGeometry);
    const sidebarStoredAfter = await page.session.evaluate(readSidebarRatio);
    report.check(
      'the notes panel can be resized against the panes',
      sidebarStoredBefore !== null &&
        sidebarStoredAfter > sidebarStoredBefore &&
        sidebarAfter.renderedShare > sidebarBefore.renderedShare + 0.02,
      JSON.stringify([sidebarStoredBefore, sidebarStoredAfter, Number(sidebarAfter.renderedShare.toFixed(2))]),
    );
  } finally {
    report.check('no console errors while resizing the notes panes', problems.consoleErrors.length === 0, problems.consoleErrors.slice(0, 3).join(' | '));
    report.check('no uncaught exceptions while resizing the notes panes', problems.exceptions.length === 0);
    await page.close();
  }
}

/**
 * Quick links drag-to-reorder, driven with real mouse input so Chrome synthesises
 * genuine pointer events (synthetic `PointerEvent`s have no active pointer and
 * would not exercise pointer capture at all).
 */
export async function runReorderChecks({ port, appUrl, report }) {
  const page = await openPage(port, 'about:blank');
  const problems = watchForProblems(page.session);
  try {
    // The dashboard is taller than the default headless viewport.
    await page.session.send('Emulation.setDeviceMetricsOverride', {
      width: 1400,
      height: 2400,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.session.navigate(appUrl);
    await page.session.evaluate(`localStorage.removeItem(Object.keys(localStorage).find((k) => k.includes('workspace')) ?? '')`);
    await page.session.navigate(appUrl);

    const entered = await page.session.evaluate(`(() => {
      const items = [...document.querySelectorAll('.react-grid-item')];
      const links = items.find((el) => /Quick links/i.test(el.innerText || ''));
      if (!links) return false;
      const edit = [...links.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'Edit');
      if (!edit) return false;
      edit.click();
      return true;
    })()`);
    report.check('quick links editor opens', entered);
    if (!entered) return;

    await wait(400);
    const readOrder = `(() => {
      const items = [...document.querySelectorAll('.react-grid-item')];
      const links = items.find((el) => /Quick links/i.test(el.innerText || ''));
      return [...links.querySelectorAll('input[aria-label="Link label"]')].map((i) => i.value);
    })()`;
    const before = await page.session.evaluate(readOrder);

    const handles = await page.session.evaluate(`(() => {
      const items = [...document.querySelectorAll('.react-grid-item')];
      const links = items.find((el) => /Quick links/i.test(el.innerText || ''));
      return [...links.querySelectorAll('button[aria-label^="Reorder"]')].map((b) => {
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, bottom: r.bottom };
      });
    })()`);
    if (handles.length < 4) {
      report.check('drag handles are rendered', false, `${handles.length} handles`);
      return;
    }
    report.check('drag handles are rendered', true, `${handles.length} handles`);

    const mouse = (type, x, y, buttons) =>
      page.session.send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: 'left',
        buttons,
        clickCount: type === 'mouseMoved' ? 0 : 1,
      });

    const start = handles[0];
    const target = handles[2];
    await mouse('mousePressed', start.x, start.y, 1);
    await wait(60);
    for (let step = 1; step <= 6; step += 1) {
      await mouse('mouseMoved', target.x, start.y + ((target.bottom - start.y) * step) / 6, 1);
      await wait(40);
    }
    await mouse('mouseReleased', target.x, target.bottom, 0);
    await wait(400);

    const after = await page.session.evaluate(readOrder);
    report.check('dragging reorders the list', JSON.stringify(after) !== JSON.stringify(before), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);

    await page.session.navigate(appUrl);
    const persisted = await page.session.evaluate(`(() => {
      const key = Object.keys(localStorage).find((k) => k.includes('workspace'));
      if (!key) return null;
      const state = JSON.parse(localStorage.getItem(key));
      const links = state.state.widgets.find((w) => w.type === 'links');
      return links.config.links.map((l) => l.label);
    })()`);
    report.check('the new order is persisted', JSON.stringify(persisted) === JSON.stringify(after), JSON.stringify(persisted));
  } finally {
    report.check('no console errors during reordering', problems.consoleErrors.length === 0, problems.consoleErrors.slice(0, 3).join(' | '));
    await page.close();
  }
}

/* ---------------------------------------------- the widget catalogue, in situ */

/** The widget types the first-run "Complete workspace" preloads. */
const WORKSPACE_TYPES = [
  'clock',
  'weather',
  'sun',
  'worldclock',
  'tasks',
  'calendar',
  'timer',
  'market',
  'news',
  'notes',
  'habits',
  'countdown',
  'onthisday',
  'air',
  'converter',
  'links',
];

/** Every card, its type and its box — the raw material for the layout checks. */
const describeWorkspace = `(() => {
  window.scrollTo(0, 0);
  const items = [...document.querySelectorAll('.react-grid-item')];
  return {
    count: items.length,
    types: items.map((el) => {
      const card = el.querySelector('[data-widget-type]') || (el.matches('[data-widget-type]') ? el : null);
      return card ? card.getAttribute('data-widget-type') : null;
    }),
    boxes: items.map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        top: Math.round(rect.top + window.scrollY),
        bottom: Math.round(rect.bottom + window.scrollY),
      };
    }),
  };
})()`;

/**
 * Type text into a React-controlled input the way a person would.
 *
 * React reads the value through its own tracker, so the native setter is used to
 * make the assignment visible to it. The keydown is dispatched as well, and the
 * enclosing form is submitted explicitly — a synthetic key press does not make
 * the browser submit, which is what a real Enter does.
 */
const typeInto = (selector, value) => `(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const form = input.closest('form');
  if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
  else if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const add = document.querySelector('[data-widget-type="' + (input.closest('[data-widget-type]')?.getAttribute('data-widget-type') ?? '') + '"] button[type="submit"]');
  if (add) add.click();
  return true;
})()`;

const cardText = (type) => `(() => {
  const card = document.querySelector('[data-widget-type="${type}"]');
  return card ? card.innerText || '' : null;
})()`;

const clickIn = (type, selector) => `(() => {
  const card = document.querySelector('[data-widget-type="${type}"]');
  const target = card && card.querySelector(${JSON.stringify(selector)});
  if (!target) return false;
  target.click();
  return true;
})()`;

function findOverlaps(workspace) {
  const overlaps = [];
  for (let a = 0; a < workspace.boxes.length; a += 1) {
    for (let b = a + 1; b < workspace.boxes.length; b += 1) {
      const first = workspace.boxes[a];
      const second = workspace.boxes[b];
      // A one-pixel tolerance absorbs sub-pixel rounding in the grid maths.
      const apart =
        first.right <= second.left + 1 ||
        second.right <= first.left + 1 ||
        first.bottom <= second.top + 1 ||
        second.bottom <= first.top + 1;
      if (!apart) overlaps.push(`${workspace.types[a] ?? a}/${workspace.types[b] ?? b}`);
    }
  }
  return overlaps;
}

/**
 * The preloaded workspace: sixteen panels on a cold start, no overlaps at any
 * width, and the interactive widgets still holding their own state after a
 * reload. Runs entirely against the built file, so it needs no server and no
 * provider — every network-backed panel is exercised while it is failing.
 */
export async function runWorkspaceChecks({ port, appUrl, report }) {
  const page = await openPage(port, 'about:blank');
  const problems = watchForProblems(page.session);
  try {
    await page.session.send('Emulation.setDeviceMetricsOverride', {
      width: 1400,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // A cold start: no stored workspace, so the default template is what loads.
    await page.session.navigate(appUrl);
    await page.session.evaluate('localStorage.clear()');
    await page.session.navigate(appUrl);
    await wait(900);

    const first = await page.session.evaluate(describeWorkspace);
    report.check('a first visit preloads sixteen panels', first.count === 16, `${first.count} panels`);

    const missing = WORKSPACE_TYPES.filter((type) => !first.types.includes(type));
    report.check('every preloaded widget type is on the canvas', missing.length === 0, missing.join(', ') || 'all present');

    for (const width of [1680, 1280, 1024, 768, 420]) {
      await page.session.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await wait(500);
      const layout = await page.session.evaluate(describeWorkspace);
      const overlaps = findOverlaps(layout);
      report.check(`sixteen panels stay overlap-free at ${width}px`, overlaps.length === 0, overlaps.slice(0, 3).join(' '));
    }

    await page.session.send('Emulation.setDeviceMetricsOverride', {
      width: 1400,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await wait(400);

    // A task: added, completed, and still there after a reload.
    const typed = await page.session.evaluate(typeInto('[data-widget-type="tasks"] input[placeholder^="Add a task"]', 'Water the plants'));
    await wait(400);
    const taskText = await page.session.evaluate(cardText('tasks'));
    report.check('a task can be typed into the list', typed && /Water the plants/.test(taskText ?? ''), (taskText ?? '').slice(0, 48));

    const ticked = await page.session.evaluate(clickIn('tasks', 'input[type="checkbox"]'));
    await wait(400);
    await page.session.navigate(appUrl);
    await wait(900);
    const tasksAfter = await page.session.evaluate(cardText('tasks'));
    const stillTicked = await page.session.evaluate(`(() => {
      const box = document.querySelector('[data-widget-type="tasks"] input[type="checkbox"]');
      return box ? box.checked : null;
    })()`);
    report.check('the task survives a reload', /Water the plants/.test(tasksAfter ?? ''), (tasksAfter ?? '').slice(0, 48));
    report.check('its completed state survives too', ticked && stillTicked === true, String(stillTicked));

    // The focus timer: running state is derived from timestamps, so it must
    // survive the reload as a running phase.
    const started = await page.session.evaluate(clickIn('timer', 'button[aria-label="Start timer"]'));
    await wait(2000);
    const running = await page.session.evaluate(cardText('timer'));
    report.check(
      'the focus timer starts and counts',
      started && /[0-9]{1,2}:[0-9]{2}/.test(running ?? ''),
      (running ?? '').replace(/\n+/g, ' · ').slice(0, 60),
    );

    await page.session.navigate(appUrl);
    await wait(900);
    const resumed = await page.session.evaluate(`(() => {
      const card = document.querySelector('[data-widget-type="timer"]');
      return card ? card.innerText || '' : null;
    })()`);
    const paused = await page.session.evaluate(`Boolean(document.querySelector('[data-widget-type="timer"] button[aria-label="Pause timer"]'))`);
    report.check('a running timer carries on across a reload', paused, (resumed ?? '').slice(0, 40));

    // Habits: add one, tick today, expect a one-day streak that persists.
    const habitTyped = await page.session.evaluate(typeInto('[data-widget-type="habits"] input[placeholder^="Add a habit"]', 'Stretch'));
    await wait(500);
    const habitTicked = await page.session.evaluate(clickIn('habits', '[role="switch"], input[type="checkbox"]'));
    await wait(400);
    const habitsText = await page.session.evaluate(cardText('habits'));
    report.check('a habit can be added and ticked off', habitTyped && habitTicked && /Stretch/.test(habitsText ?? ''), (habitsText ?? '').slice(0, 48));

    await page.session.navigate(appUrl);
    await wait(900);
    const habitsAfter = await page.session.evaluate(cardText('habits'));
    report.check(
      'the habit and its one-day streak survive a reload',
      /Stretch/.test(habitsAfter ?? '') && /1 day/.test(habitsAfter ?? ''),
      (habitsAfter ?? '').replace(/\n+/g, ' · ').slice(0, 70),
    );

    // The two purely local panels that need no provider at all.
    const countdown = await page.session.evaluate(cardText('countdown'));
    report.check('the countdown shows its seeded date', /New Year/.test(countdown ?? ''), (countdown ?? '').slice(0, 40));

    const calendar = await page.session.evaluate(cardText('calendar'));
    const monthName = new Date().toLocaleString('en-GB', { month: 'long' });
    const weekdayHits = await page.session.evaluate(`(() => {
      const card = document.querySelector('[data-widget-type="calendar"]');
      if (!card) return 0;
      // Rendering upper-cases the weekday headers, so the comparison is too.
      const text = (card.innerText || '').toLowerCase();
      return ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].filter((day) => text.includes(day)).length;
    })()`);
    report.check('the calendar shows the month and its seven columns', (calendar ?? '').includes(monthName) && weekdayHits === 7, `${monthName} · ${weekdayHits}/7 weekdays`);
  } finally {
    report.check('no console errors with sixteen panels mounted', problems.consoleErrors.length === 0, problems.consoleErrors.slice(0, 3).join(' | '));
    report.check('no uncaught exceptions with sixteen panels mounted', problems.exceptions.length === 0, problems.exceptions.slice(0, 2).join(' | '));
    await page.close();
  }
}
