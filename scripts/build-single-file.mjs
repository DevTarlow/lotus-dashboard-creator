#!/usr/bin/env node
/**
 * Finish the single-file build.
 *
 * Vite emits `dist-single/index.html` plus a JS chunk, a stylesheet and any
 * images it could not inline on its own. This script folds all of them into the
 * HTML and removes the leftovers, so the result is exactly one portable file:
 *
 *   dist-single/index.html   ← the whole dashboard app
 *
 * Run via `npm run build:single`; it expects `vite build --mode single` to have
 * run first.
 */
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist-single');
const indexPath = path.join(outDir, 'index.html');

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Resolve a reference from the built HTML to a file inside the output dir. */
function resolveAsset(reference) {
  const clean = reference.split('?')[0].split('#')[0];
  if (/^(?:[a-z]+:)?\/\//i.test(clean) || clean.startsWith('data:')) return null;
  const relative = clean.replace(/^\.?\//, '');
  const resolved = path.join(outDir, relative);
  // Refuse to read outside the build output.
  if (!resolved.startsWith(outDir + path.sep)) return null;
  return existsSync(resolved) ? resolved : null;
}

/**
 * The note that tells whoever opens this file what it is.
 *
 * It goes *after* the doctype: a comment above it puts the document into quirks
 * mode, which changes how the app lays out. It is a comment rather than markup
 * because the app replaces the entire body once JavaScript runs, and because a
 * data-loss bug in the save path (see `capturePageHtml`) once came from editing
 * this document with string surgery — so the anchor is asserted, not assumed.
 */
const FILE_NOTICE = `<!--
  Lotus Dashboard Creator — your dashboard is this one file.

  To use it: keep this file somewhere you will find it again (Documents, not
  Downloads), then double-click it. There is nothing to install and no account
  to create; it works offline.

  Your changes are kept automatically in this browser, but the copy you keep and
  the copy you send are this file — so press Ctrl+S (Cmd+S on macOS), or use
  "Save to file" in the ⋯ menu, to write your changes into it.

  To give someone your dashboard, send them this file. To keep a spare, copy it.
  Full guide: https://github.com/DevTarlow/lotus-dashboard-creator#use-it
-->
`;

/** Insert the notice directly after the doctype, failing loudly if that is gone. */
function insertFileNotice(html) {
  const match = /<!doctype[^>]*>\s*/i.exec(html);
  if (!match) throw new Error('no <!doctype> to anchor the file notice after');
  const at = match.index + match[0].length;
  return html.slice(0, at) + FILE_NOTICE + html.slice(at);
}

/** True when a reference points at something we know how to inline. */
function isInlinableAsset(reference) {
  if (reference.startsWith('data:')) return false;
  if (/^(?:[a-z]+:)?\/\//i.test(reference)) return false;
  return Boolean(MIME_BY_EXT[path.extname(reference.split('?')[0].split('#')[0]).toLowerCase()]);
}

async function toDataUri(file) {
  const mime = MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const contents = await readFile(file);
  return `data:${mime};base64,${contents.toString('base64')}`;
}

async function main() {
  if (!existsSync(indexPath)) {
    throw new Error(`No build found at ${path.relative(root, indexPath)} — run "vite build --mode single" first.`);
  }

  let html = await readFile(indexPath, 'utf8');
  const inlined = { scripts: 0, styles: 0, images: 0 };

  // 0. The human-readable note, while the anchor is still easy to find. Saving a
  //    dashboard replaces the document wholesale, so a *saved* file carries the
  //    note too — this is what a fresh build says, not something the app re-adds.
  html = insertFileNotice(html);

  // Every replacement below passes a *function*: a string replacement would let
  // `$&`/`` $` `` sequences inside minified JS or a data URI rewrite the output.
  const swap = (haystack, needle, value) => haystack.replace(needle, () => value);

  // 1. Images and icons first, while the document is still small. The extension
  //    allow-list means the JS chunk and stylesheet are left alone here.
  for (const attr of ['href', 'src']) {
    const pattern = new RegExp(`\\b${attr}="([^"]+)"`, 'gi');
    for (const match of [...html.matchAll(pattern)]) {
      const [full, reference] = match;
      if (!isInlinableAsset(reference)) continue;
      const file = resolveAsset(reference);
      if (!file) continue;
      html = swap(html, full, `${attr}="${await toDataUri(file)}"`);
      inlined.images += 1;
    }
  }

  // 2. Stylesheets.
  for (const match of [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/gi)]) {
    const [tag] = match;
    const href = /\bhref="([^"]+)"/i.exec(tag)?.[1];
    if (!href) continue;
    const file = resolveAsset(href);
    if (!file) continue;
    html = swap(html, tag, `<style>${await readFile(file, 'utf8')}</style>`);
    inlined.styles += 1;
  }

  // 3. The entry chunk last: after this the document contains the whole bundle,
  //    so nothing else should be pattern-matching over it.
  for (const match of [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/gi)]) {
    const [tag, src] = match;
    const file = resolveAsset(src);
    if (!file) continue;
    const typeMatch = /\btype="([^"]+)"/i.exec(tag);
    const type = typeMatch ? ` type="${typeMatch[1]}"` : '';
    // A literal </script> inside the bundle would end the element early.
    const code = (await readFile(file, 'utf8')).replace(/<\/script/gi, '<\\/script');
    html = swap(html, tag, `<script${type}>${code}</script>`);
    inlined.scripts += 1;
  }

  // 4. Fail loudly rather than shipping a file that needs a sibling to work.
  //    Check the *markup* only: the inlined bundle is full of `src="` snippets
  //    from its own string concatenation, and none of them are real references.
  const markup = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style></style>');
  const isLocalReference = (reference) =>
    !reference.startsWith('data:') && !reference.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(reference);
  const leftover = [...markup.matchAll(/\b(?:src|href)="([^"]*)"/gi)]
    .map((match) => match[1])
    .filter(isLocalReference);
  if (leftover.length > 0) {
    throw new Error(`still references external files: ${[...new Set(leftover)].join(', ')}`);
  }

  await writeFile(indexPath, html, 'utf8');

  // 5. Drop everything that is now embedded.
  const surplus = [];
  for (const entry of await readdir(outDir, { withFileTypes: true })) {
    const target = path.join(outDir, entry.name);
    if (entry.isDirectory() || target !== indexPath) surplus.push(target);
  }
  for (const target of surplus) await rm(target, { recursive: true, force: true });

  const { size } = await stat(indexPath);
  console.log(
    `single file: dist-single/index.html (${(size / 1024).toFixed(0)} kB) — inlined ` +
      `${inlined.scripts} script(s), ${inlined.styles} stylesheet(s), ${inlined.images} asset(s); ` +
      `removed ${surplus.length} leftover file(s)`,
  );
}

main().catch((error) => {
  console.error(`build:single failed — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
