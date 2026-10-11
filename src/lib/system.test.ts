import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetHttp } from '@/lib/http';
import {
  batteryManager,
  batteryStatusEqual,
  browserNavigator,
  browserWindow,
  deviceStatus,
  fetchPublicIp,
  formatBytes,
  formatSeconds,
  mapBatteryStatus,
  mapPublicIp,
  networkStatus,
  storageStatus,
  storageStatusEqual,
} from '@/lib/system';

beforeEach(() => {
  resetHttp();
});

describe('environment accessors', () => {
  it('read the live globals without throwing outside a browser', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('navigator', { onLine: true, language: 'en' });
    expect(browserWindow()?.devicePixelRatio).toBe(1);
    expect(browserNavigator()?.language).toBe('en');
    vi.unstubAllGlobals();
  });
});

describe('networkStatus', () => {
  it('reads the Connection API when it exists', () => {
    const status = networkStatus({
      onLine: true,
      connection: { effectiveType: '4g', downlink: 9.5, rtt: 50, saveData: false },
    });
    expect(status).toEqual({
      online: true,
      effectiveType: '4g',
      downlinkMbps: 9.5,
      rttMs: 50,
      saveData: false,
      detailed: true,
    });
  });

  it('reports the API as absent rather than inventing readings', () => {
    const status = networkStatus({ onLine: true });
    expect(status.detailed).toBe(false);
    expect(status.effectiveType).toBeNull();
    expect(status.rttMs).toBeNull();
    expect(status.saveData).toBeNull();
  });

  it('assumes online when the browser cannot answer, and offline only when it says so', () => {
    expect(networkStatus(undefined).online).toBe(true);
    expect(networkStatus({}).online).toBe(true);
    expect(networkStatus({ onLine: false }).online).toBe(false);
  });
});

describe('deviceStatus', () => {
  it('reads what is available', () => {
    const status = deviceStatus(
      { platform: 'Linux x86_64', hardwareConcurrency: 16, deviceMemory: 8, language: 'en-GB', maxTouchPoints: 0 },
      { devicePixelRatio: 2, screen: { width: 2560, height: 1440 } },
      'Europe/Lisbon',
    );
    expect(status).toMatchObject({
      platform: 'Linux x86_64',
      cores: 16,
      memoryGb: 8,
      language: 'en-GB',
      timeZone: 'Europe/Lisbon',
      pixelRatio: 2,
      touch: false,
    });
    expect(status.screen).toEqual({ width: 2560, height: 1440 });
  });

  it('marks Chromium-only fields as unknown elsewhere', () => {
    const status = deviceStatus({ platform: 'MacIntel' }, {}, 'UTC');
    expect(status.cores).toBeNull();
    expect(status.memoryGb).toBeNull();
    expect(status.screen).toBeNull();
    expect(status.pixelRatio).toBeNull();
    expect(status.platform).toBe('MacIntel');
  });

  it('notices a touch screen', () => {
    expect(deviceStatus({ maxTouchPoints: 5 }, {}, 'UTC').touch).toBe(true);
  });

  it('prefers the modern platform name over the deprecated one', () => {
    // Android reports "Linux armv8l" through `navigator.platform`.
    const status = deviceStatus({ platform: 'Linux armv8l', userAgentData: { platform: 'Android' } }, {}, 'UTC');
    expect(status.platform).toBe('Android');
  });

  it('falls back to `navigator.platform` when the modern name is missing or empty', () => {
    expect(deviceStatus({ platform: 'Win32', userAgentData: {} }, {}, 'UTC').platform).toBe('Win32');
    expect(deviceStatus({ platform: 'Win32', userAgentData: { platform: '' } }, {}, 'UTC').platform).toBe('Win32');
  });
});

describe('batteryManager', () => {
  it('hands back the live manager so a caller can subscribe to it', async () => {
    const manager = { level: 0.5 };
    expect(await batteryManager({ getBattery: () => Promise.resolve(manager) })).toBe(manager);
  });

  it('reports an absent or failing Battery API as null', async () => {
    expect(await batteryManager({})).toBeNull();
    expect(await batteryManager(undefined)).toBeNull();
    expect(await batteryManager({ getBattery: () => Promise.reject(new Error('nope')) })).toBeNull();
  });
});

describe('mapBatteryStatus', () => {
  it('reads a battery that exists', () => {
    expect(mapBatteryStatus({ level: 0.62, charging: true, chargingTime: 1800, dischargingTime: Infinity })).toEqual({
      supported: true,
      level: 0.62,
      charging: true,
      chargingTimeSeconds: 1800,
      dischargingTimeSeconds: null,
    });
  });

  it('clamps a level outside 0…1', () => {
    expect(mapBatteryStatus({ level: 7 }).level).toBe(1);
    expect(mapBatteryStatus({ level: -1 }).level).toBe(0);
  });

  it('treats a missing manager as unsupported', () => {
    const unsupported = {
      supported: false,
      level: null,
      charging: null,
      chargingTimeSeconds: null,
      dischargingTimeSeconds: null,
    };
    expect(mapBatteryStatus(null)).toEqual(unsupported);
    expect(mapBatteryStatus(undefined)).toEqual(unsupported);
  });
});

describe('storageStatus', () => {
  it('reads the estimate', async () => {
    const status = await storageStatus({ storage: { estimate: () => Promise.resolve({ usage: 1_500_000, quota: 120_000_000 }) } });
    expect(status).toEqual({ supported: true, usageBytes: 1_500_000, quotaBytes: 120_000_000 });
  });

  it('calls the estimate on its owner, not detached', async () => {
    // Chrome throws "Illegal invocation" for a bare `StorageManager.estimate()`,
    // which made every real browser report storage as unsupported while the
    // plain-object mock above stayed green.
    const storage = {
      estimate(this: unknown) {
        if (this !== storage) throw new TypeError("Failed to execute 'estimate' on 'StorageManager': Illegal invocation");
        return Promise.resolve({ usage: 42, quota: 1024 });
      },
    };
    await expect(storageStatus({ storage })).resolves.toEqual({ supported: true, usageBytes: 42, quotaBytes: 1024 });
  });

  it('reports absence and failure as unsupported', async () => {
    expect((await storageStatus({})).supported).toBe(false);
    expect((await storageStatus({ storage: {} })).supported).toBe(false);
    expect((await storageStatus({ storage: { estimate: () => Promise.reject(new Error('blocked')) } })).supported).toBe(false);
  });
});

describe('reading equality', () => {
  it('compares battery readings field by field', () => {
    const reading = mapBatteryStatus({ level: 0.5, charging: false });
    expect(batteryStatusEqual(reading, mapBatteryStatus({ level: 0.5, charging: false }))).toBe(true);
    expect(batteryStatusEqual(reading, mapBatteryStatus({ level: 0.6, charging: false }))).toBe(false);
    expect(batteryStatusEqual(reading, mapBatteryStatus({ level: 0.5, charging: true }))).toBe(false);
    expect(batteryStatusEqual(null, null)).toBe(true);
    expect(batteryStatusEqual(reading, null)).toBe(false);
  });

  it('compares storage readings field by field', () => {
    const reading = { supported: true, usageBytes: 10, quotaBytes: 100 };
    expect(storageStatusEqual(reading, { supported: true, usageBytes: 10, quotaBytes: 100 })).toBe(true);
    expect(storageStatusEqual(reading, { supported: true, usageBytes: 11, quotaBytes: 100 })).toBe(false);
    expect(storageStatusEqual(reading, { supported: true, usageBytes: 10, quotaBytes: 200 })).toBe(false);
    expect(storageStatusEqual(null, null)).toBe(true);
    expect(storageStatusEqual(reading, null)).toBe(false);
  });
});

describe('formatBytes', () => {
  it('formats each magnitude', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1_000)).toBe('1.00 kB');
    expect(formatBytes(15_000)).toBe('15.0 kB');
    expect(formatBytes(150_000)).toBe('150 kB');
    expect(formatBytes(1_500_000)).toBe('1.50 MB');
    expect(formatBytes(2_500_000_000)).toBe('2.50 GB');
  });

  it('says nothing rather than something wrong', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(-5)).toBe('—');
  });
});

describe('formatSeconds', () => {
  it('formats minutes and hours', () => {
    expect(formatSeconds(60)).toBe('1m');
    expect(formatSeconds(2700)).toBe('45m');
    expect(formatSeconds(8100)).toBe('2h 15m');
    expect(formatSeconds(7200)).toBe('2h');
  });

  it('returns a dash for unknown or negative times', () => {
    expect(formatSeconds(null)).toBe('—');
    expect(formatSeconds(0)).toBe('—');
    expect(formatSeconds(-10)).toBe('—');
    expect(formatSeconds(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('mapPublicIp', () => {
  it('maps the ipwho.is payload', () => {
    expect(
      mapPublicIp({
        ip: '203.0.113.7',
        success: true,
        city: 'Lisbon',
        region: 'Lisboa',
        country: 'Portugal',
        connection: { isp: 'Example Telecom', org: 'Example' },
      }),
    ).toEqual({ ip: '203.0.113.7', city: 'Lisbon', region: 'Lisboa', country: 'Portugal', org: 'Example Telecom' });
  });

  it('returns null for a failed lookup or a payload without an address', () => {
    expect(mapPublicIp({ success: false, message: 'reserved range' })).toBeNull();
    expect(mapPublicIp({})).toBeNull();
    expect(mapPublicIp(null)).toBeNull();
    expect(mapPublicIp({ ip: '1.2.3.4' })).toMatchObject({ ip: '1.2.3.4', city: null, country: null, org: null });
  });
});

describe('fetchPublicIp', () => {
  it('looks the address up once and caches it', async () => {
    const mock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ip: '203.0.113.7', success: true, city: 'Lisbon' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', mock);
    const signal = new AbortController().signal;

    const first = await fetchPublicIp(signal);
    const second = await fetchPublicIp(signal);

    expect(first.info?.ip).toBe('203.0.113.7');
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(String(mock.mock.calls[0][0])).toBe('https://ipwho.is/');
    vi.unstubAllGlobals();
  });

  it('surfaces a transport failure instead of a guessed address', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchPublicIp(new AbortController().signal)).rejects.toMatchObject({ code: 'network' });
    vi.unstubAllGlobals();
  });
});
