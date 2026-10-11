import { useMemo, useState } from 'react';
import { CheckIcon, MonitorIcon, MoonIcon, PaletteIcon, RefreshIcon, SunIcon } from '@/components/icons';
import { Button, Modal, Segmented, Switch, TextInput } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import { oklchToRgb, rgbToHex } from '@/lib/color';
import { buildThemeRamps, getThemePreset, THEME_PRESETS, tokensForPreset, type ThemePreset } from '@/lib/theme';
import { usePrefsStore } from '@/store/prefsStore';
import { useUiStore } from '@/store/uiStore';
import { cn } from '@/lib/utils';
import type { ThemeMode } from '@/types';

const MODE_OPTIONS: readonly { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <SunIcon className="h-3.5 w-3.5" /> },
  { value: 'dark', label: 'Dark', icon: <MoonIcon className="h-3.5 w-3.5" /> },
  { value: 'system', label: 'Match system', icon: <MonitorIcon className="h-3.5 w-3.5" /> },
];

const GROUPS: readonly ThemePreset['group'][] = ['neutral', 'warm', 'cool', 'bold'];

const GROUP_LABELS: Record<ThemePreset['group'], string> = {
  neutral: 'Neutral',
  warm: 'Warm',
  cool: 'Cool',
  bold: 'Bold',
};

/** Steps shown in a preset's swatch strip: darks, mids, accents, light. */
const SWATCH_KEYS = [
  '--color-slate-950',
  '--color-slate-800',
  '--color-slate-600',
  '--color-violet-600',
  '--color-violet-500',
  '--color-slate-200',
] as const;

/** Hue wheel for the warmth slider, drawn in the neutral ramp's own style. */
const HUE_GRADIENT = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360]
  .map((hue) => `oklch(86% 0.05 ${hue})`)
  .join(', ')})`;

/** A preset's palette at a glance, drawn from the tokens it would apply. */
function PresetSwatch({ preset }: { preset: ThemePreset }) {
  const tokens = tokensForPreset(preset.id);
  return (
    <span
      className="flex h-7 w-full overflow-hidden rounded-md ring-1 ring-slate-900/10 ring-inset dark:ring-white/10"
      aria-hidden="true"
    >
      {SWATCH_KEYS.map((key) => (
        <span key={key} className="flex-1" style={{ backgroundColor: tokens[key] }} />
      ))}
    </span>
  );
}

interface PresetCardProps {
  preset: ThemePreset;
  active: boolean;
  onSelect: () => void;
}

function PresetCard({ preset, active, onSelect }: PresetCardProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        'flex flex-col gap-2 rounded-xl border p-2.5 text-left transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60',
        active
          ? 'border-violet-400 bg-violet-50/70 dark:border-violet-500/50 dark:bg-violet-500/10'
          : 'border-slate-200 hover:border-violet-200 hover:bg-slate-50 dark:border-slate-700/70 dark:hover:border-violet-500/30 dark:hover:bg-slate-800/40',
      )}
    >
      <PresetSwatch preset={preset} />
      <span className="flex items-center gap-1.5">
        <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{preset.name}</span>
        {active ? <CheckIcon className="h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-400" /> : null}
      </span>
      <span className="line-clamp-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
        {preset.description}
      </span>
    </button>
  );
}

/**
 * Appearance: colour scheme, palette preset and colour fine-tuning.
 *
 * Picking a preset applies it straight away, so the canvas behind the dialog is
 * the preview — the swatch strip on each card just makes the choice scannable.
 */
export function AppearanceDialog() {
  const open = useUiStore((state) => state.appearanceOpen);
  const close = useUiStore((state) => state.closeAppearance);
  const {
    theme,
    setTheme,
    themeId,
    setThemePreset,
    customAccentHex,
    setCustomAccentHex,
    customNeutralHue,
    setCustomNeutralHue,
    resetAppearance,
  } = useTheme();
  /** Typed hex, kept separate so a half-finished value is not applied. */
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  /** Show the "that is not a colour" hint only once the field has been left. */
  const [hexBlurred, setHexBlurred] = useState(false);
  const showGridHints = usePrefsStore((state) => state.showGridHints);
  const setShowGridHints = usePrefsStore((state) => state.setShowGridHints);

  const preset = getThemePreset(themeId);

  // The picker control needs a concrete colour: the preset's own accent-500
  // until the user overrides it. Index 5 of the ramp is the 500 step.
  const presetAccentHex = useMemo(
    () =>
      rgbToHex(
        oklchToRgb(buildThemeRamps({ themeId, customAccentHex: '', customNeutralHue: null }).accent[5]),
      ),
    [themeId],
  );
  const accentHex = customAccentHex || presetAccentHex;
  const neutralHue = customNeutralHue ?? Math.round(preset.neutral.hue);
  const hexInvalid = hexDraft !== null && !/^#[0-9a-f]{6}$/i.test(hexDraft.trim());

  const onPickAccent = (value: string) => {
    setHexDraft(null);
    setHexBlurred(false);
    setCustomAccentHex(value);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Themes & colours"
      description="Pick a palette, then adjust it if you like. Your colours travel with a saved dashboard."
      size="lg"
      footer={
        <>
          <Button variant="secondary" icon={<RefreshIcon className="h-4 w-4" />} onClick={resetAppearance}>
            Reset colours
          </Button>
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
            Light or dark
          </h3>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              value={theme}
              onChange={setTheme}
              options={MODE_OPTIONS}
              label="Colour scheme"
              size="md"
            />
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Every palette works in both light and dark.
            </p>
          </div>
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
            <PaletteIcon className="h-3.5 w-3.5" />
            Colour palette
          </h3>
          <div className="space-y-4">
            {GROUPS.map((group) => {
              const presets = THEME_PRESETS.filter((candidate) => candidate.group === group);
              if (presets.length === 0) return null;
              return (
                <div key={group} role="group" aria-label={`${GROUP_LABELS[group]} palettes`}>
                  <p className="mb-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {GROUP_LABELS[group]}
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {presets.map((candidate) => (
                      <PresetCard
                        key={candidate.id}
                        preset={candidate}
                        active={candidate.id === themeId}
                        onSelect={() => {
                          setHexDraft(null);
                          setThemePreset(candidate.id);
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
            Fine-tune the colours
          </h3>

          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700/70">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Accent colour</p>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    Your colour is used at the palette's own shades, so text on it stays readable.
                  </p>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <input
                  type="color"
                  value={accentHex}
                  onChange={(event) => onPickAccent(event.target.value)}
                  aria-label="Pick an accent colour"
                  className="h-9 w-12 cursor-pointer rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
                />
                <TextInput
                  value={hexDraft ?? accentHex}
                  spellCheck={false}
                  maxLength={7}
                  aria-label="Accent colour value, for example #4f46e5"
                  aria-invalid={hexInvalid && hexBlurred}
                  className="w-28 font-mono text-xs"
                  onChange={(event) => {
                    const next = event.target.value;
                    setHexDraft(next);
                    setHexBlurred(false);
                    if (/^#[0-9a-f]{6}$/i.test(next.trim())) setCustomAccentHex(next.trim());
                  }}
                  onBlur={() => {
                    // Never quietly discard what was typed: say what is wrong and
                    // leave the text there so it can be corrected.
                    if (hexInvalid) setHexBlurred(true);
                    else setHexDraft(null);
                  }}
                />
                {customAccentHex === '' ? (
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    Using the palette's own accent
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => onPickAccent('')}>
                    Use the palette's accent
                  </Button>
                )}
              </div>
              {hexInvalid && hexBlurred ? (
                <p role="alert" className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">
                  Use a 6-digit colour like #4f46e5.
                </p>
              ) : null}
            </div>

            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700/70">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Neutral warmth</p>
                <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">{neutralHue}°</span>
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={360}
                  step={1}
                  value={neutralHue}
                  onChange={(event) => setCustomNeutralHue(Number(event.target.value))}
                  aria-label="Neutral hue"
                  className="theme-hue-slider w-full"
                  style={{ backgroundImage: HUE_GRADIENT }}
                />
                {customNeutralHue === null ? (
                  <span className="shrink-0 text-[11px] text-slate-400 dark:text-slate-500">
                    Using the palette's own warmth
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setCustomNeutralHue(null)}>
                    Use the palette's warmth
                  </Button>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700/70">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Show the grid dots</p>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  A faint dot grid behind your widgets, for lining them up.
                </p>
              </div>
              <Switch checked={showGridHints} onChange={setShowGridHints} label="Show the grid dots" />
            </div>

            {/* Real components on the applied palette: the honest preview. */}
            <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700/70 dark:bg-slate-900">
              <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
                Preview
              </p>
              <p className="mt-1 text-sm text-slate-900 dark:text-slate-100">
                Background, cards, borders and text all follow the palette.
              </p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Faded text is tinted the same way.
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button variant="primary" size="sm">
                  Primary action
                </Button>
                <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                  Accent chip
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-violet-600 dark:text-violet-300">
                  Accent link
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}
