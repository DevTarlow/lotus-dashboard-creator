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
| `npm run dev` | Vite dev server with HMR. | instant |
| `npm run typecheck` | `tsc --noEmit`, strict. | ~2 s |
| `npm run lint` | ESLint (flat config, TS + React hooks rules). | ~2 s |
| `npm test` | Vitest, single run (131 tests, 9 files). | ~1 s |
| `npm run test:watch` | Vitest watch mode — use while iterating on pure logic. | — |
| `npm run build` | `tsc --noEmit` + production build to `dist/`. | ~2 s |
| `npm run verify` | typecheck → lint → test → build. The full gate. | ~5 s |

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
- **UI changes** are verified by hand in the browser via `npm run dev`. README's
  *Testing & verification* section describes the CDP-driven checks used to date.
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
