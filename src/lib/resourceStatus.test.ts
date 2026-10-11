import { describe, expect, it } from 'vitest';
import { isPending, progressValue, resourceStatus } from '@/lib/resourceStatus';

describe('resourceStatus', () => {
  it('reports live data as live', () => {
    expect(resourceStatus({}).id).toBe('live');
    expect(resourceStatus({}).tone).toBe('emerald');
  });

  it('reports a cache hit as cached, not live', () => {
    const status = resourceStatus({ fromCache: true });
    expect(status.id).toBe('cached');
    expect(status.label).toBe('Cached');
  });

  it('prefers loading over cached before the first payload', () => {
    expect(resourceStatus({ pending: true, fromCache: true }).id).toBe('loading');
  });

  it('maps each failure code onto its own wording', () => {
    const cases: Array<[Parameters<typeof resourceStatus>[0]['errorCode'], string]> = [
      ['network', 'offline'],
      ['timeout', 'timed-out'],
      ['rate-limit', 'rate-limited'],
      ['parse', 'unavailable'],
      ['aborted', 'unavailable'],
      ['http', 'unavailable'],
    ];
    for (const [code, expected] of cases) {
      expect(resourceStatus({ error: 'nope', errorCode: code }).id, String(code)).toBe(expected);
    }
  });

  it('treats a 401 or 403 as a missing key rather than an outage', () => {
    expect(resourceStatus({ error: 'Unauthorised', errorCode: 'http', status: 401 }).id).toBe('key-required');
    expect(resourceStatus({ error: 'Forbidden', errorCode: 'http', status: 403 }).id).toBe('key-required');
    expect(resourceStatus({ error: 'Gone', errorCode: 'http', status: 410 }).id).toBe('unavailable');
  });

  it('carries the provider message into the detail', () => {
    expect(resourceStatus({ error: 'The provider answered 500.', errorCode: 'http' }).detail).toBe(
      'The provider answered 500.',
    );
  });

  it('never leaves a status without a label and a tone', () => {
    const statuses = [
      resourceStatus({}),
      resourceStatus({ pending: true }),
      resourceStatus({ fromCache: true }),
      resourceStatus({ error: 'x', errorCode: 'network' }),
      resourceStatus({ error: 'x', errorCode: 'http', status: 403 }),
    ];
    for (const status of statuses) {
      expect(status.label).not.toBe('');
      expect(status.detail).not.toBe('');
      expect(status.tone).not.toBe('');
    }
  });
});

describe('progressValue', () => {
  it('clamps and survives rubbish input', () => {
    expect(progressValue(0.5)).toBe(0.5);
    expect(progressValue(-3)).toBe(0);
    expect(progressValue(12)).toBe(1);
    expect(progressValue(Number.NaN)).toBe(0);
    expect(progressValue(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('isPending', () => {
  it('is true before the first answer for a key', () => {
    expect(isPending(null, true)).toBe(true);
  });

  it('is true while a load has neither data nor an error', () => {
    expect(isPending({ data: null, error: null }, true)).toBe(true);
  });

  it('is false once there is data, or a failure to show', () => {
    expect(isPending({ data: { value: 1 }, error: null }, true)).toBe(false);
    expect(isPending({ data: null, error: 'nope' }, true)).toBe(false);
    // A failed refresh keeps the last good payload, which is not pending either.
    expect(isPending({ data: { value: 1 }, error: 'nope' }, true)).toBe(false);
  });

  it('is never pending while the resource is switched off', () => {
    expect(isPending(null, false)).toBe(false);
    expect(isPending({ data: null, error: null }, false)).toBe(false);
  });
});
