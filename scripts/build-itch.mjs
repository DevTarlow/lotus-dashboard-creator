#!/usr/bin/env node
/**
 * Assemble the itch.io download — the file a visitor actually receives.
 *
 *   npm run itch:dist          # builds the single file, packages, verifies
 *
 * Contents, and only these three:
 *
 *   lotus-dashboard.html    the whole app, one self-contained file
 *   START HERE.txt          what a non-technical reader needs in ten lines
 *   LICENSE.txt             MIT, which is what the page claims
 *
 * The build is verified *before* it is packaged and the archive is verified
 * *after*, by reading the files back out of the ZIP rather than trusting the
 * staging directory. A ZIP that fails here is a ZIP that reaches a visitor
 * broken, and discovering that from the store page is too late.
 *
 * Nothing is uploaded. `npm run itch:preview` says what a push would change and
 * `npm run itch:publish` does it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARCHIVE,
  archiveProblems,
  formatBytes,
  inputMtimes,
  parseAppVersion,
  releaseZipName,
  releaseZipPath,
  staleProblems,
  versionProblems,
} from './release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const singleFile = path.join(root, 'dist-single', 'index.html');
const stageDir = path.join(root, '.itch-stage');
const zipDir = path.join(root, 'dist-itch');

/** Fail with something readable when a host tool is missing. */
function requireTool(name, hint) {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  if (!dirs.some((dir) => existsSync(path.join(dir, name)))) {
    throw new Error(`"${name}" is not on PATH — ${hint}`);
  }
}

/** Run a tool and return its stdout as text. */
function run(file, args, options = {}) {
  return execFileSync(file, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
}

/** The file names inside an archive, as `unzip` reports them. */
function archiveEntries(zipPath) {
  return run('unzip', ['-Z1', zipPath])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** The bytes of one archive entry. */
function archiveContents(zipPath, name) {
  return execFileSync('unzip', ['-p', zipPath, name], { maxBuffer: 64 * 1024 * 1024 });
}

async function main() {
  requireTool('zip', 'install Info-ZIP: apt install zip, or brew install zip.');
  requireTool('unzip', 'install Info-ZIP: apt install unzip, or brew install unzip.');

  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const appPath = path.posix.join('src', 'constants', 'app.ts');
  const appVersion = parseAppVersion(await readFile(path.join(root, appPath), 'utf8'));
  const problems = versionProblems({ packageVersion: pkg.version, appVersion, source: appPath });
  if (problems.length > 0) throw new Error(problems.join('\n'));

  if (!existsSync(singleFile)) {
    throw new Error('no dist-single/index.html — run "npm run build:single" first.');
  }

  // Refuse a build older than the code it claims to contain. The npm script
  // builds first, so this only fires for a direct `node scripts/build-itch.mjs`
  // or when a build failed after leaving the previous one in place.
  const stale = staleProblems({ builtAt: (await stat(singleFile)).mtimeMs, inputs: await inputMtimes(root) });
  if (stale.length > 0) throw new Error(stale.join('\n'));

  /* --- stage -------------------------------------------------------------- */

  // Staged outside the project on purpose. A checkout can be mounted world
  // writable, and some mounts ignore `chmod` outright, in which case the mode
  // travels into the ZIP and every visitor extracts an executable file. The OS
  // temp directory honours the mode; the staging area is transient anyway.
  const stageDir = await mkdtemp(path.join(os.tmpdir(), 'lotus-itch-'));
  await mkdir(zipDir, { recursive: true });

  // Each archive name is paired with the file it must equal, so the same map
  // checks the ZIP's contents afterwards. `LICENSE` is renamed on the way in:
  // inside the ZIP it sits next to the other two files and has to say what it is.
  const staged = new Map([
    [ARCHIVE.html, singleFile],
    [ARCHIVE.startHere, path.join(root, 'packaging', 'START HERE.txt')],
    [ARCHIVE.licence, path.join(root, 'LICENSE')],
  ]);

  const zipPath = path.join(zipDir, releaseZipName(pkg.version));

  try {
    for (const [name, source] of staged) {
      if (!existsSync(source)) throw new Error(`missing ${path.relative(root, source)}`);
      const destination = path.join(stageDir, name);
      await copyFile(source, destination);
      await chmod(destination, 0o644);
    }

    /* --- zip -------------------------------------------------------------- */

    await rm(zipPath, { force: true });
    // `-X` leaves out the extra fields that record who built the archive.
    run('zip', ['-q', '-r', '-X', zipPath, '.'], { cwd: stageDir });

    /* --- verify the archive, not the staging directory --------------------- */

    const entries = [];
    for (const name of archiveEntries(zipPath)) {
      const contents = archiveContents(zipPath, name);
      entries.push({ path: name, size: contents.length });
      // An unexpected name is left to `archiveProblems`, which reports it as one.
      const source = staged.get(name);
      if (source && !contents.equals(await readFile(source))) {
        throw new Error(`${name} inside the ZIP does not match the file it was packed from`);
      }
    }

    const found = archiveProblems(entries);
    if (found.length > 0) throw new Error(found.join('\n'));

    console.log(`\n${releaseZipPath(pkg.version)}  (${formatBytes((await stat(zipPath)).size)}, version ${pkg.version})`);
    for (const entry of entries) console.log(`  ${entry.path.padEnd(24)} ${formatBytes(entry.size)}`);
    console.log('\nthe ZIP holds the built app byte for byte, plus the guide and the licence.');
    console.log('next: npm run itch:preview   (says what a push would change; uploads nothing)');
  } catch (error) {
    // A broken archive must not sit in dist-itch looking publishable.
    await rm(zipPath, { force: true });
    throw error;
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`\nitch:dist failed — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
