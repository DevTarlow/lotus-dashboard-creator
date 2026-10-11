/**
 * What the browser can honestly say about itself.
 *
 * Every reading here comes from a web platform API, and most of them are
 * Chromium-only (`getBattery`, `deviceMemory`, `connection`) or need a secure
 * context (`storage.estimate`). The rule this module follows is that an absent
 * API is reported as **unsupported**, never as a zero — "0 GB of RAM" would be a
 * lie where "—" is the truth.
 *
 * Everything takes its environment as an argument (`navigator`, `window`) so the
 * mapping is unit testable in plain Node, where none of these APIs exist.
 */
import { requestJson } from '@/lib/http';

/** The subset of the Network Information API this widget reads. */
export interface NetworkInformationLike {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  /** `NetworkInformation` is an `EventTarget` that fires `change`. */
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

/** The subset of the Battery Status API this widget reads. */
export interface BatteryManagerLike {
  level?: number;
  charging?: boolean;
  chargingTime?: number;
  dischargingTime?: number;
  /** The manager is live: it fires `levelchange`, `chargingchange`, … */
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

export interface NavigatorLike {
  onLine?: boolean;
  language?: string;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  /** Legacy `navigator.platform`; kept as the fallback for non-Chromium. */
  platform?: string;
  /** Modern (Chromium) platform name, e.g. `macOS` or `Android`. */
  userAgentData?: { platform?: string };
  maxTouchPoints?: number;
  connection?: NetworkInformationLike;
  getBattery?: () => Promise<BatteryManagerLike>;
  storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> };
}

export interface WindowLike {
  devicePixelRatio?: number;
  screen?: { width?: number; height?: number };
}

/**
 * The live `navigator`, or `undefined` outside a browser.
 *
 * The non-standard members this module reads (`getBattery`, `deviceMemory`,
 * `connection`) are not in `lib.dom`, so the cast lives here rather than in the
 * widget — and the widget stays free of platform detection.
 */
export function browserNavigator(): NavigatorLike | undefined {
  return (globalThis as { navigator?: NavigatorLike }).navigator;
}

/** The live `window`, or `undefined` outside a browser. */
export function browserWindow(): WindowLike | undefined {
  return (globalThis as { window?: WindowLike }).window;
}

export interface NetworkStatus {
  online: boolean;
  effectiveType: string | null;
  downlinkMbps: number | null;
  rttMs: number | null;
  saveData: boolean | null;
  /** `true` when the Connection API exists at all. */
  detailed: boolean;
}

export interface BatteryStatus {
  supported: boolean;
  /** 0…1. */
  level: number | null;
  charging: boolean | null;
  /** Seconds until full while charging, or null when unknown. */
  chargingTimeSeconds: number | null;
  /** Seconds until empty while discharging, or null when unknown. */
  dischargingTimeSeconds: number | null;
}

export interface StorageStatus {
  supported: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
}

export interface DeviceStatus {
  platform: string;
  cores: number | null;
  memoryGb: number | null;
  language: string;
  timeZone: string;
  screen: { width: number; height: number } | null;
  pixelRatio: number | null;
  touch: boolean;
}

export interface PublicIpInfo {
  ip: string;
  city: string | null;
  region: string | null;
  country: string | null;
  /** ISP or organisation name. */
  org: string | null;
}

/** Address lookups rarely change; an hour keeps the third-party call rare. */
export const IP_TTL_MS = 60 * 60 * 1000;

/** `true` for a value that is a usable finite number. */
function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberOrNull(value: unknown): number | null {
  return isNumber(value) ? value : null;
}

/** The Battery API's way of saying "not applicable" is `Infinity`. */
function secondsOrNull(value: unknown): number | null {
  return isNumber(value) && value !== Infinity ? value : null;
}

export function networkStatus(nav: NavigatorLike | undefined): NetworkStatus {
  const connection = nav?.connection;
  return {
    // A browser that cannot answer is assumed to be online: claiming "offline"
    // would be a worse error than claiming nothing.
    online: nav?.onLine !== false,
    effectiveType: typeof connection?.effectiveType === 'string' ? connection.effectiveType : null,
    downlinkMbps: numberOrNull(connection?.downlink),
    rttMs: numberOrNull(connection?.rtt),
    saveData: typeof connection?.saveData === 'boolean' ? connection.saveData : null,
    detailed: connection !== undefined,
  };
}

export function deviceStatus(nav: NavigatorLike | undefined, win: WindowLike | undefined, timeZone: string): DeviceStatus {
  const screenWidth = win?.screen?.width;
  const screenHeight = win?.screen?.height;
  // `navigator.platform` is deprecated and misleading on mobile (Android reports
  // "Linux armv8l"), so the modern name wins wherever the browser offers it.
  const platform = nav?.userAgentData?.platform || nav?.platform;
  return {
    platform: platform !== undefined && platform !== '' ? platform : 'Unknown',
    cores: numberOrNull(nav?.hardwareConcurrency),
    memoryGb: numberOrNull(nav?.deviceMemory),
    language: nav?.language ?? 'Unknown',
    timeZone,
    screen: isNumber(screenWidth) && isNumber(screenHeight) ? { width: screenWidth, height: screenHeight } : null,
    pixelRatio: numberOrNull(win?.devicePixelRatio),
    touch: (nav?.maxTouchPoints ?? 0) > 0,
  };
}

const UNSUPPORTED_BATTERY: BatteryStatus = {
  supported: false,
  level: null,
  charging: null,
  chargingTimeSeconds: null,
  dischargingTimeSeconds: null,
};

/**
 * Map a live `BatteryManager` (or its absence) to a reading.
 *
 * Split out from {@link batteryManager} so a subscriber can re-map the same
 * manager on every `levelchange` without asking the browser for it again.
 */
export function mapBatteryStatus(manager: BatteryManagerLike | null | undefined): BatteryStatus {
  if (!manager) return UNSUPPORTED_BATTERY;
  const level = numberOrNull(manager.level);
  return {
    supported: true,
    level: level === null ? null : Math.min(1, Math.max(0, level)),
    charging: typeof manager.charging === 'boolean' ? manager.charging : null,
    chargingTimeSeconds: secondsOrNull(manager.chargingTime),
    dischargingTimeSeconds: secondsOrNull(manager.dischargingTime),
  };
}

/** The live `BatteryManager`, or `null` when this browser has no Battery API. */
export async function batteryManager(nav: NavigatorLike | undefined): Promise<BatteryManagerLike | null> {
  if (typeof nav?.getBattery !== 'function') return null;
  try {
    return await nav.getBattery();
  } catch {
    return null;
  }
}

const UNSUPPORTED_STORAGE: StorageStatus = { supported: false, usageBytes: null, quotaBytes: null };

export async function storageStatus(nav: NavigatorLike | undefined): Promise<StorageStatus> {
  const manager = nav?.storage;
  if (typeof manager?.estimate !== 'function') return UNSUPPORTED_STORAGE;
  try {
    // Called on its owner, not detached: Chrome throws "Illegal invocation" for a
    // bare `estimate()`, which silently reported storage as unsupported.
    const result = await manager.estimate();
    return { supported: true, usageBytes: numberOrNull(result.usage), quotaBytes: numberOrNull(result.quota) };
  } catch {
    return UNSUPPORTED_STORAGE;
  }
}

/** Field-wise equality, so an unchanged reading does not re-render a card. */
export function batteryStatusEqual(a: BatteryStatus | null, b: BatteryStatus | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.supported === b.supported &&
    a.level === b.level &&
    a.charging === b.charging &&
    a.chargingTimeSeconds === b.chargingTimeSeconds &&
    a.dischargingTimeSeconds === b.dischargingTimeSeconds
  );
}

/** Field-wise equality, so an unchanged reading does not re-render a card. */
export function storageStatusEqual(a: StorageStatus | null, b: StorageStatus | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.supported === b.supported && a.usageBytes === b.usageBytes && a.quotaBytes === b.quotaBytes;
}

const BYTE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'] as const;

/** "1.4 GB" — decimal units, which is what `navigator.storage` reports. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

/** Seconds → "2h 15m" / "45m" / "—". */
export function formatSeconds(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** Map the `ipwho.is` payload, or `null` when the lookup did not succeed. */
export function mapPublicIp(payload: unknown): PublicIpInfo | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (record.success === false) return null;
  const ip = typeof record.ip === 'string' ? record.ip : '';
  if (ip === '') return null;
  const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
  const connection = record.connection as { isp?: unknown; org?: unknown } | undefined;
  return {
    ip,
    city: text(record.city),
    region: text(record.region),
    country: text(record.country),
    org: text(connection?.isp) ?? text(connection?.org),
  };
}

/**
 * Look the caller's public address up. Opt-in in the widget: it is the one thing
 * in this module that leaves the machine, and the widget says so.
 */
export async function fetchPublicIp(signal: AbortSignal): Promise<{ info: PublicIpInfo | null; fromCache: boolean }> {
  const response = await requestJson<unknown>('ipwhois:me', 'https://ipwho.is/', { ttlMs: IP_TTL_MS, signal });
  return { info: mapPublicIp(response.data), fromCache: response.fromCache };
}
