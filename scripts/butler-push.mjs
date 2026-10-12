#!/usr/bin/env node
/**
 * Publish the itch.io download with butler.
 *
 *   npm run itch:preview    # says what a push would change; uploads nothing
 *   npm run itch:publish    # asks first, then uploads
 *
 * One channel, `download`, carrying one file: the ZIP from `npm run itch:dist`.
 * A single ZIP is one opaque blob to butler, so an update re-sends the whole
 * archive rather than diffing it. At 259 kB that is the right trade; a directory
 * channel is only worth it for a playable build, and this page has none.
 *
 * The `html5` channel is refused by name. Pushing to it is what makes itch serve
 * the project as playable, and in that iframe the app is measurably broken — see
 * `HTML5_REFUSAL` in `release.mjs`.
 *
 * Requires butler (`butler login` once, or BUTLER_API_KEY in CI) and a ZIP that
 * is newer than the source it was built from.
 *
 * Usage:
 *   node scripts/butler-push.mjs preview [--target=a/b]
 *   node scripts/butler-push.mjs publish [--target=a/b] [--hidden] [--yes]
 *
 *   --target=a/b   override the itch project (default: tarlow/lotus-dashboard)
 *   --hidden       the first push to a channel only; later pushes must omit it
 *   --yes          skip the confirmation before publishing
 *
 * Modes are named `preview` and `publish` rather than butler's own verb, because
 * in this repository "push" means `git push` and nothing else — see AGENTS.md.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  BUTLER_MISSING,
  DEFAULT_TARGET,
  findButler,
  inputMtimes,
  butlerArgs,
  releaseZipPath,
  staleProblems,
} from './release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = [
  'usage: node scripts/butler-push.mjs <preview|publish> [options]',
  '',
  '  --target=<user>/<project>   upload somewhere other than ' + DEFAULT_TARGET,
  '  --hidden                    hide the build on the page (first push only)',
  '  --yes                       skip the confirmation (publish only)',
].join('\n');

export function parseArgs(argv, env = process.env) {
  const options = { mode: null, target: env.ITCH_TARGET || DEFAULT_TARGET, hidden: false, yes: false };
  for (const arg of argv) {
    if (arg === 'preview' || arg === 'publish') {
      if (options.mode) return { error: `"${arg}" conflicts with "${options.mode}"` };
      options.mode = arg;
    } else if (arg === '--hidden') options.hidden = true;
    else if (arg === '--yes') options.yes = true;
    else if (arg.startsWith('--target=')) {
      const target = arg.slice('--target='.length);
      if (!/^[^/\s]+\/[^/\s]+$/.test(target)) return { error: `--target must look like user/project, got "${target}"` };
      options.target = target;
    } else return { error: `unknown argument "${arg}"` };
  }
  if (!options.mode) return { error: 'say what to do: preview or publish' };
  return options;
}

/**
 * The ZIP to upload, or a list of reasons there is not one.
 *
 * The staleness check is the same one `itch:dist` applies to the single-file
 * build, aimed at the archive instead: a ZIP built before the last commit would
 * upload an app that no longer matches the repository.
 */
export function resolveUpload({ mode, target, version, archive }) {
  if (!archive) {
    return { problems: [`${releaseZipPath(version)} not found — build it with: npm run itch:dist`] };
  }
  const problems = staleProblems({ builtAt: archive.mtimeMs, inputs: archive.inputs });
  if (problems.length > 0) return { problems };
  return { problems: [], spec: butlerArgs({ mode, source: releaseZipPath(version), target, version }) };
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.error) {
    console.error(`${options.error}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }

  const butler = findButler(process.env, (candidate) => existsSync(candidate));
  if (!butler) throw new Error(BUTLER_MISSING);

  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version = pkg.version;

  const zipPath = path.join(root, releaseZipPath(version));
  const archive = existsSync(zipPath)
    ? { mtimeMs: statSync(zipPath).mtimeMs, size: statSync(zipPath).size, inputs: await inputMtimes(root) }
    : null;

  const { problems, spec } = resolveUpload({ ...options, version, archive });
  if (problems.length > 0) throw new Error(problems.join('\n'));

  const publishing = options.mode === 'publish';
  console.log(`butler  : ${butler}`);
  console.log(`target  : ${options.target}`);
  console.log(`version : ${version}`);
  console.log(`artifact: ${releaseZipPath(version)}  (${Math.round(archive.size / 1024)} kB)`);
  console.log(`action  : ${publishing ? 'publish — this goes live on the page' : 'preview only — nothing is uploaded'}`);
  console.log(`\n$ butler ${spec.join(' ')}`);

  if (publishing && !options.yes) {
    if (!process.stdin.isTTY) {
      throw new Error('refusing to publish without confirmation in a non-interactive shell. Pass --yes.');
    }
    console.log('');
    if (!(await confirm(`Publish ${version} to itch now? [y/N] `))) {
      console.log('aborted — nothing was published.');
      return;
    }
  }

  // stdio inherited on purpose: butler's progress output is the only feedback
  // during the upload, and piping it degrades what butler prints.
  const result = spawnSync(butler, spec, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`butler exited ${result.status}. Nothing was published.`);

  console.log(
    publishing
      ? `\npublished ${version} to ${options.target}:download.`
      : '\npreview complete — nothing was uploaded.',
  );
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`\nitch:${process.argv[2] ?? 'push'} failed — ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
