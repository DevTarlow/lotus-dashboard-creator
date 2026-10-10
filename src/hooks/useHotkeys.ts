import { useEffect, useRef } from 'react';

export interface HotkeyDefinition {
  /** e.g. `mod+z`, `mod+shift+z`, `?`, `escape`. `mod` = ⌘ on macOS, Ctrl elsewhere. */
  combo: string;
  handler: (event: KeyboardEvent) => void;
  /** Fire even while typing in an input/textarea. Defaults to `false`. */
  allowInInput?: boolean;
  /** Temporarily disable the shortcut. */
  enabled?: boolean;
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (EDITABLE_TAGS.has(target.tagName)) return true;
  return target.isContentEditable;
}

function matches(event: KeyboardEvent, combo: string): boolean {
  const parts = combo
    .toLowerCase()
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  const key = parts[parts.length - 1];
  const wantsMod = parts.includes('mod') || parts.includes('ctrl') || parts.includes('cmd');
  const wantsShift = parts.includes('shift');
  const wantsAlt = parts.includes('alt');
  const hasMod = event.ctrlKey || event.metaKey;

  if (event.key.toLowerCase() !== key) return false;
  if (wantsMod !== hasMod) return false;
  if (wantsShift && !event.shiftKey) return false;
  if (!wantsShift && event.shiftKey && key !== '?') return false;
  if (wantsAlt !== event.altKey) return false;
  return true;
}

/** Register global keyboard shortcuts. */
export function useHotkeys(hotkeys: readonly HotkeyDefinition[]): void {
  const ref = useRef(hotkeys);

  useEffect(() => {
    ref.current = hotkeys;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      for (const hotkey of ref.current) {
        if (hotkey.enabled === false) continue;
        if (!hotkey.allowInInput && isEditableTarget(event.target)) continue;
        if (!matches(event, hotkey.combo)) continue;
        hotkey.handler(event);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
