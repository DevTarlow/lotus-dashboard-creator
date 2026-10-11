import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetHttp } from '@/lib/http';
import {
  batteryStatus,
  browserNavigator,
  browserWindow,
  deviceStatus,
  fetchPublicIp,
  formatBytes,
  formatSeconds,
  mapPublicIp,
  networkStatus,
  storageStatus,
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
});

describe('batteryStatus', () => {
  it('reads a battery that exists', async () => {
    const status = await batteryStatus({
      getBattery: () => Promise.resolve({ level: 0.62, charging: true, chargingTime: 1800, dischargingTime: Infinity }),
    });
    expect(status).toEqual({
      supported: true,
      level: 0.62,
      charging: true,
      chargingTimeSeconds: 1800,
      dischargingTimeSeconds: null,
    });
  });

  it('clamps a level outside 0…1', async () => {
    const status = await batteryStatus({ getBattery: () => Promise.resolve({ level: 7 }) });
    expect(status.level).toBe(1);
  });

  it('reports absence and failure as unsupported', async () => {
    expect((await batteryStatus({})).supported).toBe(false);
    expect((await batteryStatus(undefined)).supported).toBe(false);
    expect((await batteryStatus({ getBattery: () => Promise.reject(new Error('nope')) })).supported).toBe(false);
  });
});

describe('storageStatus', () => {
  it('reads the estimate', async () => {
    const status = await storageStatus({ storage: { estimate: () => Promise.resolve({ usage: 1_500_000, quota: 120_000_000 }) } });
    expect(status).toEqual({ supported: true, usageBytes: 1_500_000, quotaBytes: 120_000_000 });
  });

  it('reports absence and failure as unsupported', async () => {
    expect((await storageStatus({})).supported).toBe(false);
    expect((await storageStatus({ storage: {} })).supported).toBe(false);
    expect((await storageStatus({ storage: { estimate: () => Promise.reject(new Error('blocked')) } })).supported).toBe(false);
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
