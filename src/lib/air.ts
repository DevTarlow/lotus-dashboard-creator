/**
 * Air quality, UV and pollen from Open-Meteo.
 *
 * The provider is keyless, sends `access-control-allow-origin: *` and needs no
 * signup, which is why it is the source here. The banding (what counts as
 * "moderate", what to do about it) is **ours**: Open-Meteo reports numbers, and
 * the widget turns them into the headline a person actually wants. Those tables
 * are the US EPA AQI breakpoints, the WHO/WMO UV index scale, and Open-Meteo's
 * own pollen scale, and they live here so they can be unit tested.
 *
 * Pollen is only reported where the model covers it (mostly Europe) and only in
 * season, so a missing reading is normal: absent fields are reported as absent,
 * never as zero.
 */
import { requestJson } from '@/lib/http';
import type { GeoPlace } from '@/lib/geocode';
import type { AccentTone } from '@/types';

/** Air quality changes slowly; a quarter-hour window keeps the API quiet. */
export const AIR_REFRESH_MS = 15 * 60 * 1000;

const AIR_ENDPOINT = 'https://air-quality-api.open-meteo.com/v1/air-quality';

const CURRENT_FIELDS = [
  'us_aqi',
  'pm2_5',
  'pm10',
  'ozone',
  'nitrogen_dioxide',
  'sulphur_dioxide',
  'carbon_monoxide',
  'uv_index',
  'grass_pollen',
  'birch_pollen',
  'alder_pollen',
  'ragweed_pollen',
  'mugwort_pollen',
] as const;

export interface PollenReading {
  grass: number | null;
  birch: number | null;
  alder: number | null;
  ragweed: number | null;
  mugwort: number | null;
}

export interface AirReading {
  /** ISO local time as the provider reports it, e.g. `2026-10-11T03:00`. */
  time: string;
  usAqi: number | null;
  pm2_5: number | null;
  pm10: number | null;
  ozone: number | null;
  nitrogenDioxide: number | null;
  sulphurDioxide: number | null;
  carbonMonoxide: number | null;
  uvIndex: number | null;
  pollen: PollenReading;
}

export interface AirHour {
  time: string;
  /** Hour of the day, parsed from the provider's ISO string. */
  hour: number;
  usAqi: number | null;
  uvIndex: number | null;
}

export interface AirSnapshot {
  current: AirReading;
  /** The next twelve hours, starting at the current hour. */
  hours: AirHour[];
  /** Highest UV index forecast for today, when the provider sent one. */
  uvMaxToday: number | null;
  /** Time zone the provider reported for the place. */
  timeZone: string | null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pick(record: Record<string, unknown>, key: string): number | null {
  return numberOrNull(record[key]);
}

/** Parse the provider's `YYYY-MM-DDTHH:mm` string into an hour of the day. */
export function hourOf(isoTime: string): number {
  const match = /T(\d{2})/.exec(isoTime);
  if (!match) return 0;
  const hour = Number(match[1]);
  return Number.isFinite(hour) ? hour : 0;
}

/** Map the payload, or `null` when it does not carry current conditions. */
export function mapAirPayload(payload: unknown): AirSnapshot | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const current = record.current;
  if (typeof current !== 'object' || current === null) return null;
  const currentRecord = current as Record<string, unknown>;

  const reading: AirReading = {
    time: typeof currentRecord.time === 'string' ? currentRecord.time : '',
    usAqi: pick(currentRecord, 'us_aqi'),
    pm2_5: pick(currentRecord, 'pm2_5'),
    pm10: pick(currentRecord, 'pm10'),
    ozone: pick(currentRecord, 'ozone'),
    nitrogenDioxide: pick(currentRecord, 'nitrogen_dioxide'),
    sulphurDioxide: pick(currentRecord, 'sulphur_dioxide'),
    carbonMonoxide: pick(currentRecord, 'carbon_monoxide'),
    uvIndex: pick(currentRecord, 'uv_index'),
    pollen: {
      grass: pick(currentRecord, 'grass_pollen'),
      birch: pick(currentRecord, 'birch_pollen'),
      alder: pick(currentRecord, 'alder_pollen'),
      ragweed: pick(currentRecord, 'ragweed_pollen'),
      mugwort: pick(currentRecord, 'mugwort_pollen'),
    },
  };

  const hourly = record.hourly as Record<string, unknown> | undefined;
  const times = Array.isArray(hourly?.time) ? (hourly.time as unknown[]) : [];
  const aqi = Array.isArray(hourly?.us_aqi) ? (hourly.us_aqi as unknown[]) : [];
  const uv = Array.isArray(hourly?.uv_index) ? (hourly.uv_index as unknown[]) : [];

  const all: AirHour[] = times
    .map((value, index) => {
      const time = typeof value === 'string' ? value : '';
      return {
        time,
        hour: hourOf(time),
        usAqi: numberOrNull(aqi[index]),
        uvIndex: numberOrNull(uv[index]),
      };
    })
    .filter((entry) => entry.time !== '');

  // Start at the hour the reading belongs to, then take twelve hours of it.
  const currentHour = hourOf(reading.time);
  const startIndex = all.findIndex((entry) => entry.hour === currentHour);
  const hours = all.slice(startIndex >= 0 ? startIndex : 0, (startIndex >= 0 ? startIndex : 0) + 12);

  // The day's UV peak, not the strip's: `forecast_days=1` means every hourly
  // entry belongs to today, including the hours already behind us.
  const uvValues = all.map((entry) => entry.uvIndex).filter((value): value is number => value !== null);

  return {
    current: reading,
    hours,
    uvMaxToday: uvValues.length > 0 ? Math.max(...uvValues) : null,
    timeZone: typeof record.timezone === 'string' ? record.timezone : null,
  };
}

/** Fetch current conditions for a place. */
export async function fetchAir(
  place: GeoPlace,
  signal: AbortSignal,
): Promise<{ data: AirSnapshot | null; fromCache: boolean }> {
  const url =
    `${AIR_ENDPOINT}?latitude=${place.latitude.toFixed(4)}&longitude=${place.longitude.toFixed(4)}` +
    `&current=${CURRENT_FIELDS.join(',')}&hourly=us_aqi,uv_index&forecast_days=1&timezone=auto`;
  const key = `open-meteo-air:${place.latitude.toFixed(4)},${place.longitude.toFixed(4)}`;
  const response = await requestJson<unknown>(key, url, { ttlMs: AIR_REFRESH_MS, signal });
  return { data: mapAirPayload(response.data), fromCache: response.fromCache };
}

/* ------------------------------------------------------------------ banding */

export interface Band {
  id: string;
  label: string;
  tone: AccentTone;
  /** What the reading means, in one line. */
  advice: string;
}

/** US EPA AQI breakpoints and their meaning. */
const AQI_BANDS: readonly (Band & { max: number })[] = [
  { id: 'good', max: 50, label: 'Good', tone: 'emerald', advice: 'Air quality is satisfactory.' },
  { id: 'moderate', max: 100, label: 'Moderate', tone: 'amber', advice: 'Acceptable, though sensitive people may notice it.' },
  { id: 'unhealthy-sensitive', max: 150, label: 'Unhealthy for some', tone: 'amber', advice: 'Sensitive groups should limit long outdoor effort.' },
  { id: 'unhealthy', max: 200, label: 'Unhealthy', tone: 'rose', advice: 'Everyone may feel effects; reduce outdoor exertion.' },
  { id: 'very-unhealthy', max: 300, label: 'Very unhealthy', tone: 'rose', advice: 'Avoid outdoor exertion.' },
  { id: 'hazardous', max: Number.POSITIVE_INFINITY, label: 'Hazardous', tone: 'rose', advice: 'Stay indoors; authorities advise on protection.' },
];

/** What to say when there is no reading at all. */
export const NO_AQI_BAND: Band = {
  id: 'unknown',
  label: 'No reading',
  tone: 'slate',
  advice: 'The provider did not report an air-quality index for this place.',
};

export function aqiBand(aqi: number | null): Band {
  if (aqi === null || !Number.isFinite(aqi) || aqi < 0) return NO_AQI_BAND;
  const band = AQI_BANDS.find((entry) => aqi <= entry.max) ?? AQI_BANDS[AQI_BANDS.length - 1];
  return { id: band.id, label: band.label, tone: band.tone, advice: band.advice };
}

/** UV index scale (WHO). */
export function uvBand(uv: number | null): Band {
  if (uv === null || !Number.isFinite(uv) || uv < 0) {
    return { id: 'unknown', label: 'No reading', tone: 'slate', advice: 'The provider did not report a UV index.' };
  }
  if (uv < 3) return { id: 'low', label: 'Low', tone: 'emerald', advice: 'No protection needed.' };
  if (uv < 6) return { id: 'moderate', label: 'Moderate', tone: 'amber', advice: 'Shade at midday; sunscreen if you burn easily.' };
  if (uv < 8) return { id: 'high', label: 'High', tone: 'amber', advice: 'Sunscreen, a hat and shade around midday.' };
  if (uv < 11) return { id: 'very-high', label: 'Very high', tone: 'rose', advice: 'Avoid the sun between 11:00 and 16:00.' };
  return { id: 'extreme', label: 'Extreme', tone: 'rose', advice: 'Stay out of the sun; unprotected skin burns quickly.' };
}

/** Open-Meteo's pollen scale, in grains per cubic metre. */
export function pollenBand(value: number | null): Band {
  if (value === null || !Number.isFinite(value)) {
    return { id: 'unknown', label: 'No data', tone: 'slate', advice: 'Not reported here.' };
  }
  if (value < 1) return { id: 'none', label: 'None', tone: 'emerald', advice: 'Nothing in the air.' };
  if (value < 10) return { id: 'low', label: 'Low', tone: 'emerald', advice: 'Barely noticeable.' };
  if (value < 50) return { id: 'moderate', label: 'Moderate', tone: 'amber', advice: 'Noticeable if you are sensitive.' };
  if (value < 100) return { id: 'high', label: 'High', tone: 'rose', advice: 'Allergy sufferers will feel this.' };
  return { id: 'very-high', label: 'Very high', tone: 'rose', advice: 'Keep windows shut and take antihistamines early.' };
}

export interface PollenRow {
  id: keyof PollenReading;
  label: string;
  value: number | null;
  band: Band;
}

const POLLEN_LABELS: Record<keyof PollenReading, string> = {
  grass: 'Grass',
  birch: 'Birch',
  alder: 'Alder',
  ragweed: 'Ragweed',
  mugwort: 'Mugwort',
};

/** Pollen rows that actually have a reading, strongest first. */
export function pollenRows(reading: PollenReading): PollenRow[] {
  return (Object.keys(POLLEN_LABELS) as (keyof PollenReading)[])
    .map((id) => ({ id, label: POLLEN_LABELS[id], value: reading[id], band: pollenBand(reading[id]) }))
    .filter((row) => row.value !== null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
}

export interface PollutantRow {
  id: string;
  label: string;
  value: number | null;
  unit: string;
}

/** The pollutant table, in the order a person reads it. */
export function pollutantRows(reading: AirReading): PollutantRow[] {
  return [
    { id: 'pm2_5', label: 'PM2.5', value: reading.pm2_5, unit: 'µg/m³' },
    { id: 'pm10', label: 'PM10', value: reading.pm10, unit: 'µg/m³' },
    { id: 'ozone', label: 'Ozone', value: reading.ozone, unit: 'µg/m³' },
    { id: 'no2', label: 'NO₂', value: reading.nitrogenDioxide, unit: 'µg/m³' },
    { id: 'so2', label: 'SO₂', value: reading.sulphurDioxide, unit: 'µg/m³' },
    { id: 'co', label: 'CO', value: reading.carbonMonoxide, unit: 'µg/m³' },
  ];
}

/** `true` when the reading carries nothing at all worth showing. */
export function isEmptyReading(reading: AirReading): boolean {
  return (
    reading.usAqi === null &&
    reading.pm2_5 === null &&
    reading.pm10 === null &&
    reading.uvIndex === null &&
    pollenRows(reading.pollen).length === 0
  );
}
