import { clamp } from '@/lib/utils';

/**
 * Where a panel's data came from, and how to say it honestly.
 *
 * Every live widget has to admit which of several states it is in, and the
 * wording matters: a cached payload is not "live", a missing API key is not a
 * network failure, and a rate limit is not "unavailable". This pure mapping is
 * shared by the widgets' footers so the vocabulary stays identical across the
 * catalogue.
 */
export type ResourceStatusId =
  | 'loading'
  | 'live'
  | 'cached'
  | 'offline'
  | 'timed-out'
  | 'rate-limited'
  | 'key-required'
  | 'unavailable';

export type ResourceStatusTone = 'violet' | 'sky' | 'amber' | 'emerald' | 'rose' | 'slate';

export interface ResourceStatus {
  id: ResourceStatusId;
  /** Short badge label. */
  label: string;
  tone: ResourceStatusTone;
  /** Longer explanation, used as the badge's `title` and in empty states. */
  detail: string;
}

const STATUSES: Record<ResourceStatusId, Omit<ResourceStatus, 'id'>> = {
  loading: { label: 'Loading', tone: 'slate', detail: 'Waiting for the provider to answer.' },
  live: { label: 'Live', tone: 'emerald', detail: 'Fetched from the provider just now.' },
  cached: {
    label: 'Cached',
    tone: 'slate',
    detail: 'Served from this session’s cache; the provider is not re-asked until the refresh window passes.',
  },
  offline: { label: 'Offline', tone: 'amber', detail: 'This device reports no network connection.' },
  'timed-out': { label: 'Timed out', tone: 'amber', detail: 'The provider did not answer in time.' },
  'rate-limited': {
    label: 'Rate limited',
    tone: 'amber',
    detail: 'The provider refused this request for now; it will be retried in the next refresh window.',
  },
  'key-required': {
    label: 'Key required',
    tone: 'violet',
    detail: 'This provider refuses anonymous requests. Add your own free key in the widget settings.',
  },
  unavailable: { label: 'Unavailable', tone: 'rose', detail: 'The provider could not be read.' },
};

export interface ResourceStatusInput {
  pending?: boolean;
  error?: string | null;
  errorCode?: 'network' | 'timeout' | 'http' | 'rate-limit' | 'parse' | 'aborted' | null;
  /** HTTP status when the failure carried one. */
  status?: number | null;
  fromCache?: boolean;
}

/** Describe the state of a resource load in one badge. */
export function resourceStatus(input: ResourceStatusInput): ResourceStatus {
  const withDetail = (id: ResourceStatusId, detail?: string): ResourceStatus => ({
    id,
    ...STATUSES[id],
    ...(detail ? { detail } : {}),
  });

  if (input.error) {
    const code = input.errorCode ?? null;
    if (code === 'network') return withDetail('offline', input.error);
    if (code === 'timeout') return withDetail('timed-out', input.error);
    if (code === 'rate-limit') return withDetail('rate-limited', input.error);
    if (code === 'parse') return withDetail('unavailable', input.error);
    if (code === 'http' && (input.status === 401 || input.status === 403)) return withDetail('key-required', input.error);
    return withDetail('unavailable', input.error);
  }
  if (input.pending) return withDetail('loading');
  if (input.fromCache) return withDetail('cached');
  return withDetail('live');
}

/**
 * The state of a load, for the three separate questions a widget asks.
 *
 * `pending` must be true *before* the first answer as well as during it: a card
 * that had not loaded yet used to read "Live", which is the one label it must
 * never wear. Hence "no snapshot for this key" counts as pending, and a failed
 * first attempt does not (the widget shows the failure instead).
 */
export interface ResourceSnapshotLike {
  data: unknown;
  error: string | null;
}

export function isPending(snapshot: ResourceSnapshotLike | null, enabled: boolean): boolean {
  if (!enabled) return false;
  if (snapshot === null) return true;
  return snapshot.data === null && snapshot.error === null;
}

/** Clamp a 0..1 progress value, tolerating `NaN` from a provider. */
export function progressValue(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0;
}
