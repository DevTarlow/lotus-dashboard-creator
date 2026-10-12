#!/usr/bin/env node
/**
 * The parts of the itch.io release that are worth testing.
 *
 * `build-itch.mjs` and `butler-push.mjs` do the I/O: they build, copy, zip,
 * inspect and spawn. The decisions they make — which version is being published,
 * what belongs in the archive, what butler's argv looks like, where butler lives
 * — are pure functions of their inputs and live here, so the unit suite can pin
 * them without a filesystem, a network or a store page.
 *
 * Two of these are guards rather than conveniences.
 *
 * The version check exists because the ZIP is named after `package.json` while
 * the app shows `APP_VERSION` in **Help**. A file published as 1.0.1 whose own
 * About box says 1.0.0 is a support ticket, so the two are compared before
 * anything is packaged and again before anything is uploaded.
 *
 * The channel check exists because this page is deliberately download-only. See
 * `HTML5_REFUSAL` for what a playable build would break.
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/** itch.io project, `user/project`, all lower case. Override with `ITCH_TARGET`. */
export const DEFAULT_TARGET = 'tarlow/lotus-dashboard';

/** The one channel this release has. See `resolveChannel`. */
export const CHANNEL = 'download';

/**
 * Names inside the ZIP, and the only three files it may contain.
 *
 * `lotus-dashboard.html` is not a free choice: the README's *Use it* steps, the
 * GitHub release asset and this download all hand the reader the same name.
 */
export const ARCHIVE = {
  html: 'lotus-dashboard.html',
  startHere: 'START HERE.txt',
  licence: 'LICENSE.txt',
};

/**
 * itch's documented upload limits, from https://itch.io/docs/creators/html5.
 *
 * They are enforced at *upload* time and they are written for a playable HTML5
 * build, which this release is not. The archive is three files and under a
 * megabyte, so they are a sanity check rather than a real constraint — but a
 * violation should be discovered here, by a script, rather than on the store.
 */
export const LIMITS = {
  maxFiles: 1000,
  maxPathLength: 240,
  maxTotalBytes: 500 * 1024 * 1024,
  maxFileBytes: 200 * 1024 * 1024,
};

/** Why pushing anything to the `html5` channel is refused, in full. */
export const HTML5_REFUSAL = [
  'refusing to push to the "html5" channel.',
  '',
  'This page sells the file, not a playable build. Pushing to html5 is what makes',
  'itch serve the project inside its own iframe, and in that iframe the app is',
  'measurably broken:',
  '',
  '  Save to file   showSaveFilePicker() throws SecurityError, because a file',
  '                 picker may not be shown from a cross-origin subframe.',
  '  Copy buttons   clipboard-write is denied by the iframe permissions policy.',
  '  The workspace  itch sets scrolling="no", and the app is taller than the',
  '                 frame, so the lower panels cannot be scrolled into view.',
  '',
  'Upload the ZIP to the `download` channel instead.',
].join('\n');

/** The ZIP a release produces, by version. */
export function releaseZipName(version) {
  return `LotusDashboardCreator-${version}.zip`;
}

/** Where `build-itch.mjs` writes it, relative to the project root. */
export function releaseZipPath(version) {
  return path.posix.join('dist-itch', releaseZipName(version));
}

/**
 * Everything the single-file build is derived from.
 *
 * `dist-single/index.html` survives between runs, so both release scripts
 * compare its timestamp against these before trusting it. Without that, a script
 * that only looked for the file would happily package, or publish, the app as it
 * was before the last few commits.
 */
export const BUILD_INPUTS = ['src', 'index.html', 'vite.config.ts', 'tsconfig.json', 'package.json'];

/**
 * Newest modification time under a file or directory, in milliseconds.
 *
 * The one piece of I/O in this module. Everything around it is pure, so the
 * decision it feeds (`staleProblems`) is still tested without a filesystem.
 */
export async function newestMtime(target) {
  let stats;
  try {
    stats = await stat(target);
  } catch {
    return 0;
  }
  if (stats.isFile()) return stats.mtimeMs;
  let newest = stats.mtimeMs;
  for (const entry of await readdir(target, { withFileTypes: true })) {
    newest = Math.max(newest, await newestMtime(path.join(target, entry.name)));
  }
  return newest;
}

/** The modification times of every build input, as `[{ path, mtime }]`. */
export async function inputMtimes(root) {
  return Promise.all(
    BUILD_INPUTS.map(async (input) => ({ path: input, mtime: await newestMtime(path.join(root, input)) })),
  );
}

/** Why an artifact built at `builtAt` may no longer be trusted, as sentences. */
export function staleProblems({ builtAt, inputs }) {
  const changed = inputs.filter((input) => input.mtime > builtAt).map((input) => input.path);
  if (changed.length === 0) return [];
  return [
    `${changed.join(', ')} changed after this build was made, so it is out of date.`,
    'Rebuild before publishing: npm run itch:dist',
  ];
}

/**
 * Read `APP_VERSION` out of the TypeScript constant.
 *
 * A regex rather than an import: the scripts are plain `.mjs` run straight by
 * node, and `src/constants/app.ts` is TypeScript. The suite tests this against
 * the real file, so a change to the constant's shape fails loudly.
 */
export function parseAppVersion(source) {
  const match = /APP_VERSION\s*=\s*'([^']+)'/.exec(source);
  return match ? match[1] : null;
}

/** Everything wrong with the version pair, as sentences. */
export function versionProblems({ packageVersion, appVersion, source = 'src/constants/app.ts' }) {
  const problems = [];
  if (!packageVersion) problems.push('package.json has no "version" field');
  if (!appVersion) problems.push(`could not read APP_VERSION from ${source} — has the constant moved?`);
  if (packageVersion && appVersion && packageVersion !== appVersion) {
    problems.push(
      `package.json says ${packageVersion} but ${source} says ${appVersion}. ` +
        'The ZIP is named after one and the app reports the other, so they must match.',
    );
  }
  return problems;
}

/**
 * Everything wrong with the archive's contents.
 *
 * `entries` is `[{ path, size }]` for the files actually inside the ZIP, read
 * back out of it rather than trusted from the staging directory.
 */
export function archiveProblems(entries) {
  const problems = [];
  const expected = Object.values(ARCHIVE).sort();
  const names = entries.map((entry) => entry.path).sort();

  const missing = expected.filter((name) => !names.includes(name));
  const extra = names.filter((name) => !expected.includes(name));
  if (missing.length > 0) problems.push(`missing from the ZIP: ${missing.join(', ')}`);
  if (extra.length > 0) problems.push(`unexpected in the ZIP: ${extra.join(', ')}`);

  // Every entry at the root: the reader unzips one folder's worth of files, and
  // nothing has to be dug out of a nested directory.
  const nested = names.filter((name) => name.includes('/'));
  if (nested.length > 0) problems.push(`nested inside the ZIP: ${nested.join(', ')}`);

  if (entries.length > LIMITS.maxFiles) {
    problems.push(`${entries.length} files, over itch's limit of ${LIMITS.maxFiles}`);
  }
  for (const entry of entries) {
    if (entry.path.length > LIMITS.maxPathLength) {
      problems.push(`path longer than ${LIMITS.maxPathLength} characters: ${entry.path}`);
    }
    if (entry.size > LIMITS.maxFileBytes) {
      problems.push(`${entry.path} is ${formatBytes(entry.size)}, over itch's per-file limit`);
    }
  }
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (total > LIMITS.maxTotalBytes) {
    problems.push(`the archive holds ${formatBytes(total)}, over itch's total limit`);
  }

  return problems;
}

/**
 * The one channel this release may be pushed to.
 *
 * `html5` is refused by name rather than ignored, because it is the mistake that
 * would silently undo the download-only decision: see `HTML5_REFUSAL`.
 */
export function resolveChannel(requested = null) {
  if (requested === null || requested === CHANNEL) return CHANNEL;
  if (requested === 'html5') throw new Error(HTML5_REFUSAL);
  throw new Error(`unknown channel "${requested}" — this release has one: ${CHANNEL}`);
}

/**
 * The exact argv handed to butler.
 *
 * `push-preview` never creates a build, so butler rejects the build-creation
 * flags it would otherwise accept and has no `--userversion`. Encoding that rule
 * here, rather than at the call site, is what the unit test pins down.
 *
 * `source` is the ZIP. A single file is one opaque blob to butler, so an update
 * re-sends the whole archive; it is a few hundred kilobytes, which is why that
 * trade is fine here. A directory channel is only for playable builds.
 */
export function butlerArgs({ mode, source, target = DEFAULT_TARGET, channel = null, version, hidden = false }) {
  const spec = `${target}:${resolveChannel(channel)}`;
  if (mode === 'preview') return ['push-preview', '--changes-only', source, spec];
  if (mode !== 'publish') throw new Error(`unknown mode "${mode}" — expected "preview" or "publish"`);
  if (!version) throw new Error('publishing needs a version, for butler\'s --userversion');
  return ['push', source, spec, '--userversion', version, ...(hidden ? ['--hidden'] : [])];
}

/**
 * Every path butler might be at, most specific first.
 *
 * `BUTLER_PATH` wins so an unusual install can be named outright. itch's own
 * guide installs butler to `~/bin`, and non-interactive shells routinely leave
 * that off `PATH` — which is why it is checked rather than assumed.
 */
export function butlerCandidates(env = process.env) {
  const names = process.platform === 'win32' ? ['butler.exe', 'butler'] : ['butler'];
  const dirs = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return [
    ...(env.BUTLER_PATH ? [env.BUTLER_PATH] : []),
    ...dirs.flatMap((dir) => names.map((name) => path.join(dir, name))),
    ...(env.HOME ? names.map((name) => path.join(env.HOME, 'bin', name)) : []),
  ];
}

/** The first candidate that exists, or `null`. `isExecutable` is injectable. */
export function findButler(env = process.env, isExecutable = () => false) {
  for (const candidate of butlerCandidates(env)) {
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

/** What to tell someone whose machine has no butler on it. */
export const BUTLER_MISSING = [
  'could not find butler.',
  '',
  'Install it (https://itch.io/docs/butler/installing.html), then either put it',
  'on PATH or set BUTLER_PATH to the executable. itch\'s installer writes it to',
  '~/bin, which non-interactive shells do not have on PATH.',
].join('\n');

/**
 * Width and height from a PNG's IHDR, or `null` when it is not a PNG.
 *
 * Used to prove the generated cover and banner are the exact plates itch asks
 * for, rather than trusting the canvas that drew them.
 */
export function pngSize(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  if (!buffer.subarray(0, 8).equals(signature)) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Bytes as something a person reads, e.g. `836 kB`. */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
