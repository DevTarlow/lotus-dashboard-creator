import type { ReactNode } from 'react';
import { GridIcon, PlusIcon, SaveIcon, WandIcon } from '@/components/icons';

/**
 * The four things a first-time user needs, phrased for someone who has never
 * seen a drag-and-drop dashboard.
 *
 * Shared by the first-run welcome and the always-available Help dialog, so the
 * two can never drift apart. The drag and resize wording deliberately matches
 * the toasts the app already raises when a widget is added.
 */
interface Step {
  icon: ReactNode;
  title: string;
  body: ReactNode;
}

const STEPS: readonly Step[] = [
  {
    icon: <PlusIcon className="h-4 w-4" />,
    title: 'Add a widget',
    body: (
      <>
        Press <strong className="font-semibold text-slate-700 dark:text-slate-200">Add widget</strong> at the top
        right, then add a card with a click or by dragging it onto the page.
      </>
    ),
  },
  {
    icon: <GridIcon className="h-4 w-4" />,
    title: 'Move and resize it',
    body: (
      <>
        Drag a card by its <em className="not-italic font-medium text-slate-700 dark:text-slate-200">title bar</em> to
        move it, and by its bottom-right corner to resize it.
      </>
    ),
  },
  {
    icon: <WandIcon className="h-4 w-4" />,
    title: 'Tidy up when it looks messy',
    body: <>Press Tidy up in the toolbar and the gaps close themselves.</>,
  },
  {
    icon: <SaveIcon className="h-4 w-4" />,
    title: 'Keep it',
    body: (
      <>
        Your changes are saved in this browser as you work. To keep them in{' '}
        <strong className="font-semibold text-slate-700 dark:text-slate-200">this file</strong> — so it is up to date
        when you open it again, or send it to someone — press ⌘/Ctrl&nbsp;+&nbsp;S, or use{' '}
        <strong className="font-semibold text-slate-700 dark:text-slate-200">Save to file</strong> in the ⋯ menu.
      </>
    ),
  },
];

/** Numbered, plain-language getting-started list. */
export function GettingStarted() {
  return (
    <ol className="space-y-3">
      {STEPS.map((step, index) => (
        <li key={step.title} className="flex gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
            {step.icon}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              <span className="mr-1.5 text-slate-400 dark:text-slate-500">{index + 1}.</span>
              {step.title}
            </p>
            <p className="mt-0.5 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
