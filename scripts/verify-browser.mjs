#!/usr/bin/env node
/**
 * Browser verification.
 *
 *   npm run verify:browser                 # the built single file, from file://
 *   npm run verify:browser -- --dev        # also check a running server
 *   npm run verify:browser -- --dev --dev-url=http://localhost:4173
 *
 * The unit suite is Node-only by design, so the parts that touch real DOM APIs —
 * serialising the running app, pointer-driven drag and drop, persistence across a
 * reload — are verified here instead, in a real Chrome, over the DevTools
 * protocol. The single-file checks need no server at all: they open the built
 * artifact from disk, which is exactly how the user will open it.
 *
 * Requires Chrome or Chromium; set CHROME_PATH if it is not on PATH.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isReachable, launchChrome } from './browser/cdp.mjs';
import { runAppChecks, runNotesChecks, runReorderChecks, runSingleFileChecks } from './browser/checks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class Report {
  constructor() {
    this.results = [];
    this.group = '(general)';
  }
  startGroup(group) {
    this.group = group;
  }
  check(name, ok, detail = '') {
    this.results.push({ group: this.group, name, ok: Boolean(ok), detail: detail === '' ? '' : String(detail) });
  }
  get failures() {
    return this.results.filter((result) => !result.ok);
  }
  print() {
    let currentGroup = null;
    for (const result of this.results) {
      if (result.group !== currentGroup) {
        currentGroup = result.group;
        console.log(`\n${currentGroup}`);
      }
      const mark = result.ok ? '  \u2713' : '  \u2717';
      console.log(`${mark} ${result.name}${result.detail ? `  — ${result.detail}` : ''}`);
    }
    const passed = this.results.length - this.failures.length;
    console.log(`\n${passed}/${this.results.length} checks passed`);
    if (this.failures.length > 0) {
      console.log('\nFailures:');
      for (const failure of this.failures) {
        console.log(`  \u2717 ${failure.group} / ${failure.name}${failure.detail ? ` — ${failure.detail}` : ''}`);
      }
    }
  }
}

function parseArgs(argv) {
  const options = {
    dev: false,
    devUrl: 'http://localhost:5173',
    single: path.join(root, 'dist-single', 'index.html'),
  };
  for (const arg of argv) {
    if (arg === '--dev') options.dev = true;
    else if (arg.startsWith('--dev-url=')) options.devUrl = arg.slice('--dev-url='.length);
    else if (arg.startsWith('--single=')) options.single = path.resolve(arg.slice('--single='.length));
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exitCode = 2;
      return null;
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (!options) process.exit(2);

const report = new Report();

if (!existsSync(options.single)) {
  console.error(
    `No single-file build at ${path.relative(root, options.single)}.\n` +
      'Run `npm run build:single` first (or use `npm run verify:browser`, which builds it for you).',
  );
  process.exit(1);
}

if (options.dev && !(await isReachable(options.devUrl))) {
  report.startGroup(`server (${options.devUrl})`);
  report.check('server is reachable', false, 'start it with `npm run dev`, or pass --dev-url');
}

let chrome = null;
let downloadDir = null;
try {
  chrome = await launchChrome();
  downloadDir = await mkdtemp(path.join(os.tmpdir(), 'lotus-downloads-'));

  console.log(`Chrome ${path.basename(chrome.binary)} on port ${chrome.port}`);
  console.log(`single file: ${path.relative(root, options.single)}`);

  report.startGroup('single file (file://)');
  try {
    await runSingleFileChecks({
      port: chrome.port,
      singleFile: options.single,
      downloadDir,
      report,
    });
  } catch (error) {
    report.check('single-file checks completed', false, error.message);
  }

  if (options.dev && (await isReachable(options.devUrl))) {
    report.startGroup(`app (${options.devUrl})`);
    try {
      await runAppChecks({ port: chrome.port, appUrl: options.devUrl, report });
    } catch (error) {
      report.check('app checks completed', false, error.message);
    }

    report.startGroup('notes file panel');
    try {
      await runNotesChecks({ port: chrome.port, appUrl: options.devUrl, report });
    } catch (error) {
      report.check('notes checks completed', false, error.message);
    }

    report.startGroup('quick links reordering');
    try {
      await runReorderChecks({ port: chrome.port, appUrl: options.devUrl, report });
    } catch (error) {
      report.check('reorder checks completed', false, error.message);
    }
  }
} catch (error) {
  report.startGroup('browser');
  report.check('browser launched', false, error.message);
} finally {
  if (chrome) await chrome.close();
  if (downloadDir) await rm(downloadDir, { recursive: true, force: true }).catch(() => {});
}

report.print();
if (report.failures.length > 0) process.exitCode = 1;
