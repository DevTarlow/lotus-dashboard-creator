/**
 * Inline SVG icon set.
 *
 * Hand-rolled instead of pulling an icon package: ~30 icons cost less than a
 * dependency, tree-shake perfectly and inherit `currentColor`.
 */
import type { ReactNode } from 'react';
import type { IconProps } from '@/types';
import { cn } from '@/lib/utils';

interface SvgProps extends IconProps {
  children: ReactNode;
  /** Fill the glyph instead of stroking it. */
  filled?: boolean;
}

function Icon({ className, children, filled = false }: SvgProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('h-5 w-5 shrink-0', className)}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/* ------------------------------------------------------------- navigation */

export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const ChevronDownIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

export const ChevronRightIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m9 6 6 6-6 6" />
  </Icon>
);

export const ArrowUpIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);

export const ArrowDownIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Icon>
);

export const ArrowUpRightIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7 17 17 7M9 7h8v8" />
  </Icon>
);

export const UndoIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h9a7 7 0 0 1 0 14h-3" />
  </Icon>
);

export const RedoIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9h-9a7 7 0 0 0 0 14h3" />
  </Icon>
);

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);

export const MenuIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

/** Collapse/expand a side panel (used by the notes file manager). */
export const PanelLeftIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9.5 4v16" />
  </Icon>
);

export const MoreIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </Icon>
);

/* ---------------------------------------------------------------- actions */

export const GearIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.2a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4 1.7 1.7 0 0 0-1.6 1Z" />
  </Icon>
);

export const TrashIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </Icon>
);

export const CopyIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H6a2 2 0 0 0-2 2v7a2.5 2.5 0 0 0 2.5 2.5" />
  </Icon>
);

export const CheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m5 13 4.5 4.5L19 7" />
  </Icon>
);

export const PencilIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  </Icon>
);

export const RefreshIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20 4v5h-5" />
  </Icon>
);

export const DownloadIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
    <path d="M5 19h14" />
  </Icon>
);

export const UploadIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 16V5M7.5 9.5 12 5l4.5 4.5" />
    <path d="M5 19h14" />
  </Icon>
);

/** Floppy disk — the "save the dashboard to its file" action. */
export const SaveIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 4h10.5L20 8.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
    <path d="M8 4v5h6.5V4" />
    <path d="M7.5 20v-5.5h9V20" />
  </Icon>
);

export const LockIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
);

export const UnlockIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 7.5-2" />
  </Icon>
);

export const GripIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="9" cy="6" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="15" cy="6" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="15" cy="18" r="1.3" fill="currentColor" stroke="none" />
  </Icon>
);

export const SparklesIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4Z" />
    <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" />
  </Icon>
);

export const WandIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 20 14.5 9.5" />
    <path d="M15.5 4.5 16 6l1.5.5L16 7l-.5 1.5L15 7l-1.5-.5L15 6l.5-1.5Z" />
    <path d="M19.5 10.5l.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4.4-1.1Z" />
  </Icon>
);

export const KeyboardIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
  </Icon>
);

export const ExternalLinkIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14 5h5v5" />
    <path d="M19 5 10 14" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Icon>
);

/* ----------------------------------------------------------------- theme */

export const SunIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);

export const MoonIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </Icon>
);

export const MonitorIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M9 20h6M12 16v4" />
  </Icon>
);

/* -------------------------------------------------------------- feedback */

export const InfoIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Icon>
);

export const AlertIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10.3 4.3 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 16.5h.01" />
  </Icon>
);

export const PlugIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 3v5M15 3v5" />
    <path d="M7 8h10v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5V8Z" />
    <path d="M12 16v5" />
  </Icon>
);

export const GridIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
  </Icon>
);

/* ------------------------------------------------------------ widget icons */

export const ClockIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3.2 2" />
  </Icon>
);

export const WeatherIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 4v2M6.3 6.3l1.4 1.4M4 12h2M17.7 6.3l-1.4 1.4" />
    <path d="M9 18a3.5 3.5 0 0 1 .4-7 4.5 4.5 0 0 1 8.6 1.2A3 3 0 0 1 17.5 18H9Z" />
  </Icon>
);

export const NotesIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
    <path d="M14 3v6h6" />
    <path d="M9 13h6M9 17h4" />
  </Icon>
);

/** A post-it: a square with one folded corner. */
export const StickyNoteIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 4.5h15v9.5l-5.5 5.5h-9.5z" />
    <path d="M19.5 14h-5.5v5.5" />
  </Icon>
);

/** A pushpin, drawn upright so it still reads at 14px. */
export const PinIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 4h6l-.8 4.2 3.3 3.3H6.5l3.3-3.3z" />
    <path d="M12 11.5V20" />
  </Icon>
);

export const LinksIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="6" rx="2" />
    <rect x="3" y="14" width="18" height="6" rx="2" />
    <path d="M7 7h.01M7 17h.01" />
  </Icon>
);

export const MarketIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 19h16" />
    <path d="m5 15 4-4 3 3 5-6" />
    <path d="M14 8h3v3" />
  </Icon>
);

export const NewsIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 5h11a1 1 0 0 1 1 1v13H5a1 1 0 0 1-1-1V5Z" />
    <path d="M16 9h3a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2h-2" />
    <path d="M7 9h5M7 12h5M7 15h3" />
  </Icon>
);

export const EyeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const SplitIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M12 4v16" />
  </Icon>
);

export const TasksIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 6.5 5.8 8.3 9 5" />
    <path d="M4 17.5 5.8 19.3 9 16" />
    <path d="M12 7h8M12 12h5M12 17h8" />
  </Icon>
);

export const TimerIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="13" r="7.5" />
    <path d="M12 9.5V13l2.5 1.7M9.5 2.5h5" />
  </Icon>
);

export const HabitsIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="14" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3" y="13.5" width="7" height="7" rx="1.5" />
    <path d="m14.5 16.5 1.8 1.8 3.2-3.4" />
  </Icon>
);

export const CalendarIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
    <path d="M7.5 14h2M12 14h2M16.5 14h.01M7.5 17.5h2M12 17.5h2" />
  </Icon>
);

export const CountdownIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5.6 5.6A9 9 0 1 0 12 3" />
    <path d="M3 7V4h3M12 3V1" />
    <path d="M12 7v5l3 2" />
  </Icon>
);

export const GlobeIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3c2.6 2.6 3.9 6 3.9 9S14.6 18.4 12 21c-2.6-2.6-3.9-6-3.9-9S9.4 5.6 12 3Z" />
  </Icon>
);

export const ConverterIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 8h13l-3-3M20 16H7l3 3" />
    <path d="M20 8h-1M4 16h1" />
  </Icon>
);

export const SunMoonIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
  </Icon>
);

export const AirIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 8h9.5a2.5 2.5 0 1 0-2.5-2.5" />
    <path d="M3 12.5h13a2.5 2.5 0 1 1-2.5 2.5" />
    <path d="M3 17h6" />
  </Icon>
);

export const QuakeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2 13h3l2-6 3 12 2.5-9L15 17l2-4h5" />
  </Icon>
);

export const OnThisDayIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5.5A1.5 1.5 0 0 1 4 18.5v-13Z" />
    <path d="M19 8h1.5A1.5 1.5 0 0 1 22 9.5v9a1.5 1.5 0 0 1-1.5 1.5H6" />
    <path d="M8 8h7M8 11.5h7M8 15h4" />
  </Icon>
);

export const SystemIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
    <path d="M7 12h2l1.5-3 2 5 1.5-2h3" />
  </Icon>
);

export const RepoIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 3.5h10a1.5 1.5 0 0 1 1.5 1.5v15l-3-2-3 2-3-2-3 2V5A1.5 1.5 0 0 1 6 3.5Z" />
    <path d="M9 8h5M9 11.5h3" />
  </Icon>
);

/* -------------------------------------------------------- control glyphs */

export const PlayIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 5.5v13l10-6.5-10-6.5Z" />
  </Icon>
);

export const PauseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 5v14M15 5v14" />
  </Icon>
);

export const RotateIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 5v6h-6" />
  </Icon>
);

export const BellIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2.5h-15L6 16.5Z" />
    <path d="M10 20.5a2 2 0 0 0 4 0" />
  </Icon>
);

export const MapPinIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 21s6.5-6 6.5-11a6.5 6.5 0 1 0-13 0C5.5 15 12 21 12 21Z" />
    <circle cx="12" cy="10" r="2.5" />
  </Icon>
);

export const FlameIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3s5 4.2 5 8.4A5 5 0 0 1 7 12c0-1.6.7-2.9 1.6-4 .3 1.1 1 1.8 2 2 0-2.6 1.4-5.4 1.4-7Z" />
  </Icon>
);

export const BatteryIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2.5" y="8" width="16" height="9" rx="2" />
    <path d="M21 11v3" />
    <path d="M6 11v3M9.5 11v3" />
  </Icon>
);

export const WifiIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 9a13 13 0 0 1 17 0M6.5 12.5a8.5 8.5 0 0 1 11 0M9.5 16a4 4 0 0 1 5 0" />
    <path d="M12 19.5h.01" />
  </Icon>
);
