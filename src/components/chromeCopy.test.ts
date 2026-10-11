import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The words the app shows to someone who has never seen a dashboard builder.
 *
 * This is a source scan rather than a render, for the same reason
 * `theme.test.ts` pins the inline script in `index.html` and `storageKeys.test.ts`
 * pins one expression: the copy lives in components that need stores, a DOM and a
 * browser to render, and the thing worth protecting is the wording itself.
 *
 * It is deliberately a list of *phrases* rather than single words. "breakpoint"
 * is a real identifier and "plugin" appears in code that has nothing to do with
 * what a user reads, so banning words would fight the source instead of the copy.
 */

/** The chrome, the overlays and the messages a user meets on the first screen. */
const SHELL_FILES = [
  'src/App.tsx',
  'src/components/layout/HeaderBar.tsx',
  'src/components/layout/DashboardCanvas.tsx',
  'src/components/layout/ImportDropZone.tsx',
  'src/components/layout/WidgetFrame.tsx',
  'src/components/feedback/StorageNotice.tsx',
  'src/components/feedback/SeedNotice.tsx',
  'src/components/modals/GettingStarted.tsx',
  'src/components/modals/HelpDialog.tsx',
  'src/components/modals/ImportDialog.tsx',
  'src/components/modals/TemplatesDialog.tsx',
  'src/components/modals/WelcomeDialog.tsx',
  'src/components/modals/WidgetSettingsModal.tsx',
  'src/components/modals/AppearanceDialog.tsx',
  'src/components/modals/ConfirmDialog.tsx',
  'src/hooks/useDashboardActions.ts',
  'src/lib/validation.ts',
];

/** Copy that was written for the maintainer rather than for the user. */
const BANNED: readonly { pattern: RegExp; phrase: string; why: string }[] = [
  // A grid column count only ever reached the screen as "<n> cols".
  { pattern: /\d+ cols\b/, phrase: '12 cols', why: 'a column count is a grid implementation detail' },
  { pattern: /localStorage/, phrase: 'localStorage', why: "the storage mechanism is not the user's vocabulary" },
  { pattern: /schema v/, phrase: 'schema v', why: 'a schema version means nothing outside the code' },
  { pattern: /missing plugin/, phrase: 'missing plugin', why: 'there is no plugin concept in the interface' },
  { pattern: /plugin missing/, phrase: 'plugin missing', why: 'there is no plugin concept in the interface' },
  { pattern: /Export layout as JSON/, phrase: 'Export layout as JSON', why: 'a backup is a backup' },
  { pattern: /Import layout from JSON/, phrase: 'Import layout from JSON', why: 'restoring a backup is restoring a backup' },
  { pattern: /Copy layout JSON/, phrase: 'Copy layout JSON', why: 'the clipboard holds a backup, not a layout' },
  { pattern: /Not saved — storage blocked/, phrase: 'Not saved — storage blocked', why: 'say what it means for the dashboard' },
  { pattern: /Widget unavailable/, phrase: 'Widget unavailable', why: 'name what is actually missing' },
  { pattern: /Reset to default/, phrase: 'Reset to default', why: 'the starter dashboard is the name of the thing' },
  { pattern: /Reapply/, phrase: 'Reapply', why: 'restoring the starter is not a re-application' },
  { pattern: /Remove without asking next time/, phrase: 'Remove without asking next time', why: 'a double negative in a destructive dialog' },
  {
    pattern: /Everything is saved in your browser automatically/,
    phrase: 'Everything is saved in your browser automatically',
    why: 'the file is a second layer, and this implies otherwise',
  },
  { pattern: /Gaps were closed on every breakpoint/, phrase: 'Gaps were closed on every breakpoint', why: "breakpoints are not the user's concern" },
  { pattern: /Your canvas is empty/, phrase: 'Your canvas is empty', why: 'say what to do, not what is missing' },
  { pattern: /This widget hit an error/, phrase: 'This widget hit an error', why: 'describe the state in plain words' },
  { pattern: /The file is not valid JSON/, phrase: 'The file is not valid JSON', why: 'a parser message is not an explanation' },
];

/**
 * Drop comments before scanning.
 *
 * The source is allowed to explain itself in the maintainer's vocabulary — the
 * rule is about what reaches the screen. `(^|[^:])` keeps `https://` intact.
 */
function stripComments(contents: string): string {
  return contents.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Copy the app is built around, so a rewrite cannot quietly drop it. */
const REQUIRED = [
  'Save to file',
  'Save a backup (.json)',
  'Restore from a backup (.json)',
  'Help & shortcuts',
  'Add widget',
  'Your changes are saved in this browser as you work',
];

function source(file: string): string {
  return stripComments(readFileSync(path.join(process.cwd(), file), 'utf8'));
}

describe('user-facing copy', () => {
  it.each(BANNED)('never says "$phrase" ($why)', ({ pattern, phrase }) => {
    const offenders = SHELL_FILES.filter((file) => pattern.test(source(file)));
    expect(offenders, `“${phrase}” is back in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('keeps the words the first-run welcome and the menus are built on', () => {
    const shell = SHELL_FILES.map(source).join('\n');
    for (const phrase of REQUIRED) {
      expect(shell, `“${phrase}” has gone missing`).toContain(phrase);
    }
  });

  it('uses one honest sentence about where the work is kept', () => {
    // The footer, the welcome and the help panel all describe the same two
    // layers; they are allowed to differ in wording but not in claim.
    const header = source('src/components/layout/HeaderBar.tsx');
    expect(header).toContain('Saved to ${linkedFileName}');
    expect(header).toContain('use Save to file to keep the file up to date');
    expect(header).not.toContain("'Saved in this browser'");
  });
});
