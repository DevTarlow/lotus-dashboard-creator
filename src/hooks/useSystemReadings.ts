/**
 * The live half of `@/lib/system`.
 *
 * Everything in `@/lib/system` is a pure mapping from a web API to a plain
 * reading — that is what makes it unit testable in plain Node. A reading only
 * stays *correct* while the component lives, though, and that needs listeners:
 * a browser that goes offline fires `offline`, a battery that starts charging
 * fires `chargingchange`, and a tab that is hidden fires `visibilitychange`.
 * These hooks own that wiring so the widget stays a view.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  batteryManager,
  batteryStatusEqual,
  browserNavigator,
  mapBatteryStatus,
  networkStatus,
  storageStatus,
  storageStatusEqual,
  type BatteryManagerLike,
  type BatteryStatus,
  type NetworkStatus,
  type StorageStatus,
} from '@/lib/system';
import { useInterval } from './useInterval';

/** What a `BatteryManager` fires when one of its readings changes. */
const BATTERY_EVENTS = [
  'levelchange',
  'chargingchange',
  'chargingtimechange',
  'dischargingtimechange',
] as const;

/** Storage usage has no change event, so it is re-read on a slow tick instead. */
const STORAGE_REFRESH_MS = 60_000;

/** Online state and the Connection API, kept current by the browser's events. */
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>(() => networkStatus(browserNavigator()));

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const connection = browserNavigator()?.connection;
    const update = () => setStatus(networkStatus(browserNavigator()));

    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    connection?.addEventListener?.('change', update);
    // Connectivity can also have changed between the first render and this effect.
    update();

    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      connection?.removeEventListener?.('change', update);
    };
  }, []);

  return status;
}

/**
 * Battery reading, or `null` until the first one arrives.
 *
 * A disabled hook does not touch the API at all (there is no way to read the
 * battery without asking for it), and `null` means "not read yet" so the widget
 * never flashes "this browser does not report battery state" at a browser that
 * does.
 */
export function useBatteryStatus(enabled = true): BatteryStatus | null {
  const [status, setStatus] = useState<BatteryStatus | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let manager: BatteryManagerLike | null = null;
    let active = true;
    // An event can fire with the same values the manager already had, so the
    // reading is only stored when a field actually moved.
    const update = () =>
      setStatus((previous) => {
        const next = mapBatteryStatus(manager);
        return batteryStatusEqual(previous, next) ? previous : next;
      });

    void batteryManager(browserNavigator()).then((next) => {
      if (!active) return;
      manager = next;
      update();
      for (const event of BATTERY_EVENTS) manager?.addEventListener?.(event, update);
    });

    return () => {
      active = false;
      for (const event of BATTERY_EVENTS) manager?.removeEventListener?.(event, update);
    };
  }, [enabled]);

  return enabled ? status : null;
}

/**
 * Browser storage usage, or `null` until the first estimate arrives.
 *
 * `enabled` false leaves `navigator.storage` untouched; the estimate is otherwise
 * re-read on a slow tick, because a site's usage only changes when the site
 * writes something.
 */
export function useStorageStatus(enabled = true, refreshMs = STORAGE_REFRESH_MS): StorageStatus | null {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    // Reset on mount: React's development double-invoke unmounts and remounts
    // the effect on the same instance, and the flag must come back with it.
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const read = useCallback(() => {
    void storageStatus(browserNavigator()).then((next) => {
      if (!alive.current) return;
      setStatus((previous) => (storageStatusEqual(previous, next) ? previous : next));
    });
  }, []);

  useEffect(() => {
    if (enabled) read();
  }, [enabled, read]);

  useInterval(read, enabled ? refreshMs : null);

  return enabled ? status : null;
}

/** Whether the document is visible, kept current by `visibilitychange`. */
export function useDocumentVisibility(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onChange = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  return visible;
}
