# AGENTS.md

Guidance for AI coding agents working in **lotus-dashboard-creator**.

Read [`README.md`](./README.md) first for the architecture, widget plugin model and
feature list. This file covers *how we work*: the dev loop, verification gates, and
the git policy.

## The loop, in short

1. **Develop** with `npm run dev` (Vite + HMR on <http://localhost:5173>).
2. **Verify fast** before committing: `npm run typecheck && npm test` (a few seconds).
3. **Commit** as soon as a task is finished — do **not** wait to be asked.
4. **Run the full gate** `npm run verify` when a task is complete and before pushing.
5. **Push only when the user explicitly asks.** Never push on your own initiative.

## Commands

| Command | What it does | Typical time |
| --- | --- | --- |
| `npm run dev` | Vite dev server with HMR. Port **5173 is pinned** — if it is busy the server refuses to start rather than hopping to 5174, because `localStorage` is per-origin and a port change looks like data loss. | instant |
| `npm run typecheck` | `tsc --noEmit`, strict. | ~2 s |
| `npm run lint` | ESLint (flat config, TS + React hooks rules). | ~2 s |
| `npm test` | Vitest, single run (817 tests, 40 files). | ~2 s |
| `npm run test:watch` | Vitest watch mode — use while iterating on pure logic. | — |
| `npm run build` | `tsc --noEmit` + production build to `dist/` (multi-file). | ~2 s |
| `npm run build:single` | `tsc --noEmit` + `vite build --mode single` + `scripts/build-single-file.mjs` → **one** file, `dist-single/index.html`. | ~3 s |
| `npm run verify` | typecheck → lint → test → build → build:single. The full gate. | ~8 s |
| `npm run verify:browser` | Builds the single file and drives it in real headless Chrome (44 checks; 91 with `-- --dev`). Needs Chrome; set `CHROME_PATH` if it is not on PATH. | ~20 s |

Everything is fast here, so there is no excuse for committing a red tree.

## Verification policy

- **Before a commit:** typecheck + tests at minimum. Add `npm run lint` when you
  touched React components or hooks.
- **Before a push:** always `npm run verify` (typecheck + lint + tests + build).
- **Tests** are colocated as `src/**/*.test.ts(x)`, run in a `node` environment with
  `src/test/setup.ts` providing an in-memory `localStorage`. No DOM needed.
- **Add tests for pure logic** — `src/lib/**` (grid maths, validation, markdown,
  providers, templates) and `src/store/**`. Provider tests mock `fetch`; keep that
  pattern rather than adding network-dependent tests.
- **UI and interaction changes** are covered by `npm run verify:browser` instead
  (see below) — it drives the built artifact in real Chrome. Run it when you touch
  serialisation, drag/paste interactions, persistence, or the single-file build.
  Add `-- --dev` to also exercise a server you have running on 5173.
- Do not weaken `tsconfig.json` strictness to make something compile.

## Git policy

- **Commit after every completed task, unprompted.** The user reviews commits and
  decides when to push.
- **Conventional Commits**, imperative subject, ≤ ~72 chars:
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `perf:`.
  Add a body when the change needs explaining (what changed *and* what was verified).
- **One task = one commit.** Do not bundle unrelated work.
- **Check `git status` first and stage the files that belong to the task** rather
  than blindly `git add -A`.
- **Never push until told.** When told, run `npm run verify`, then `git push`, then
  report the branch and commit hash.
- **Never rewrite shared history:** no force-push, no `--amend` or rebase on commits
  already on `origin/main`. Ask before any destructive or history-rewriting command.
- `dist/`, `node_modules/` and caches are gitignored — never commit build output.
- No secrets in the repo. The Finnhub key is user-supplied and lives only in
  `localStorage` (`prefsStore`); it must never be hardcoded or committed.

## Repo conventions

- **`src/` layout** and module responsibilities are catalogued in README's *Project
  structure*. Put code where its neighbours already live.
- **`@/*` path alias** maps to `src/*` (`tsconfig.json`); use it instead of long
  relative imports.
- **`src/widgets/registry.ts` is the single source of truth** for widget types.
  Gallery, settings, import validation and persistence rehydration all read from it —
  add a widget by adding a folder plus one registry entry.
- **Keep `src/lib/**` pure and unit-tested**; React components stay thin and receive
  data through props/hooks. Widgets must not import `dashboardStore`.
- **Strict TypeScript** with `noUnusedLocals`/`noUnusedParameters` — remove dead code
  rather than prefixing it away.
- **Styling** is Tailwind v4; theme tokens live in `src/styles/index.css`. Match the
  existing dark/light conventions (`dark:` variants, `cn()` helper).
- **Update [`README.md`](./README.md)** whenever user-facing behaviour, scripts or
  the feature list changes — it is the project's front door and is kept current.

## Persistence architecture — easy to break, please read

Two storage layers, and the load-time rule that joins them:

1. **`localStorage`** — the live workspace (`dashboardStore`) and preferences
   (`prefsStore`), written as you edit.
2. **The embedded snapshot** — the dashboard frozen into the HTML file itself, in
   `<script type="application/json" id="lotus-embedded-workspace">`. Produced by
   "Save to file"; see `src/lib/embedded.ts` and `src/lib/singleFile.ts`.

On load, **whichever layer is newer wins** (`shouldPreferEmbedded`, compared via
`savedAt` / `updatedAt`). Breaking that rule either loses unsaved edits or ignores
a file the user was just sent.

Things that must stay true:

- **Key scoping.** `src/lib/storageKeys.ts` suffixes the keys with
  `location.pathname` on `file:`, because every `file://` document shares one
  origin. The inline theme script in `index.html` duplicates that expression
  (it runs before the bundle) — change one and you must change the other.
- **Never embed the Finnhub key.** `prefsStore` promises it stays in
  `localStorage`; a saved file is shareable.
- **Inject the snapshot through the DOM**, never with `html.replace(/<\/body>/, …)`.
  The minified bundle contains that literal sequence in its own source, so a
  string match lands *inside the script* and corrupts the file. This bug shipped
  once and was caught only by the browser round-trip check.
- **New images belong in `src/assets/`, imported from JS/CSS.** There is no
  `public/` directory any more: files there are copied verbatim and cannot be
  inlined, which breaks the one-file guarantee (`scripts/build-single-file.mjs`
  fails the build if any local reference survives).
- **Saving from the dev server is not standalone** (the file references
  `/src/...` and the HMR client). The save action warns about this in DEV; the
  single-file build is the real deliverable.

Pure logic here (`embedded.ts`, `singleFile.ts`, `storageKeys.ts`) is unit tested.
`capturePageHtml` touches the real DOM, so it is covered by `npm run verify:browser`
instead: it opens `dist-single/index.html` from disk, changes a setting, saves,
reopens the saved file from a **different path** and asserts the setting came back.
The different path is the whole point — it means a different `localStorage` scope,
so only the embedded snapshot can explain the result. Keep that assertion honest if
you refactor; it is the one that catches this class of bug.

## Environment note: git "dubious ownership"

In some sandboxed sessions the checkout is owned by a different uid than the git
user and the global gitconfig is read-only, so plain `git` commands fail with:

> fatal: detected dubious ownership in repository

Work around it per command (do **not** try to write `/home/<user>/.gitconfig` —
it is read-only and the attempt fails with `could not lock config file`):

```bash
R="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
git -c safe.directory="$R" status
```

`git -c safe.directory='*'` also works when typed literally in a shell, but it is
easy to mangle when stored in a variable — prefer the absolute path. A
`GIT_CONFIG_GLOBAL` file under `/tmp` works too, but only within the same shell
invocation, so create it immediately before use rather than relying on it
persisting.

Push rights come from the `gh` credential helper (`gh auth git-credential`).

## Keeping this file honest

If the workflow changes — new scripts, different gates, different commit or push
policy — update this file in the same commit as the change.
