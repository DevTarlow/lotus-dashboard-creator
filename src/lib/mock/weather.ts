/**
 * Simulated weather.
 *
 * Everything is derived from a hash of the city name plus the current 10 minute
 * bucket, so the same city always shows the same weather within a window and the
 * numbers move smoothly as the day progresses. No API key, no network, no
 * surprises in tests.
 */
import { createSeededRandom, hashString } from '@/lib/utils';

export type WeatherCondition = 'clear' | 'partly-cloudy' | 'cloudy' | 'drizzle' | 'rain' | 'sleet' | 'storm' | 'snow' | 'fog';
export type TemperatureUnit = 'metric' | 'imperial';

export interface HourlyForecast {
  /** Epoch ms of the forecast hour. */
  timestamp: number;
  temperatureC: number;
  condition: WeatherCondition;
  precipitationChance: number;
}

export interface WeatherSnapshot {
  city: string;
  /** Resolved region/country, when the provider reports one. */
  region?: string;
  condition: WeatherCondition;
  temperatureC: number;
  feelsLikeC: number;
  humidity: number;
  windKph: number;
  highC: number;
  lowC: number;
  summary: string;
  sunriseHour: number;
  sunsetHour: number;
  hourly: HourlyForecast[];
  /** Always true — the UI labels simulated data honestly. */
  simulated: boolean;
  /** Wall-clock reading time reported by a live provider, as it supplied it. */
  observedAt?: string;
  updatedAt: number;
}

export const CONDITION_LABELS: Record<WeatherCondition, string> = {
  clear: 'Clear sky',
  'partly-cloudy': 'Partly cloudy',
  cloudy: 'Overcast',
  drizzle: 'Light drizzle',
  rain: 'Rain showers',
  sleet: 'Sleet',
  storm: 'Thunderstorms',
  snow: 'Snow',
  fog: 'Fog',
};

const CONDITIONS: readonly WeatherCondition[] = [
  'clear',
  'clear',
  'partly-cloudy',
  'partly-cloudy',
  'cloudy',
  'drizzle',
  'rain',
  'storm',
  'fog',
  'snow',
];

/** 10 minute window — long enough to be stable, short enough to feel alive. */
export const WEATHER_BUCKET_MS = 10 * 60 * 1000;

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86400000);
}

/** Seasonal baseline in °C, assuming a northern hemisphere location. */
function seasonalBaseline(date: Date, latitude: number): number {
  const seasonal = Math.cos(((dayOfYear(date) - 196) / 365) * Math.PI * 2);
  const equator = 27;
  return equator - (1 - Math.abs(latitude) / 90) * 12 - seasonal * (6 + (Math.abs(latitude) / 90) * 22);
}

function pickCondition(random: () => number, temperatureC: number): WeatherCondition {
  const roll = random();
  if (temperatureC < 1) return roll > 0.7 ? 'snow' : 'cloudy';
  if (temperatureC < 8) return CONDITIONS[Math.floor(roll * 6)];
  return CONDITIONS[Math.floor(roll * CONDITIONS.length)];
}

function hourLabelCondition(timestamp: number, citySeed: number): WeatherCondition {
  const random = createSeededRandom(citySeed ^ Math.floor(timestamp / 3600000));
  return pickCondition(random, 10);
}

/** Compute the weather snapshot for a city. */
export function getWeather(city: string, now: number = Date.now()): WeatherSnapshot {
  const name = city.trim() || 'Lisbon';
  const citySeed = hashString(name.toLowerCase());
  const bucket = Math.floor(now / WEATHER_BUCKET_MS);
  const random = createSeededRandom(citySeed ^ bucket);
  const date = new Date(now);

  const latitude = (random() - 0.5) * 110; // -55° … 55°
  const baseline = seasonalBaseline(date, latitude);
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
  const diurnal = Math.sin(((hour - 9) / 24) * Math.PI * 2) * 5.5;
  const jitter = (random() - 0.5) * 4;
  const temperatureC = baseline + diurnal + jitter;

  const condition = pickCondition(random, temperatureC);
  const humidity = Math.round(38 + random() * 52 + (condition === 'rain' || condition === 'storm' ? 8 : 0));
  const windKph = Number((3 + random() * 26).toFixed(0));
  const feelsLikeC = Number((temperatureC - windKph * 0.06 + (humidity - 50) * 0.03).toFixed(1));

  const hours: HourlyForecast[] = [];
  for (let step = 1; step <= 6; step += 1) {
    const timestamp = now + step * 3600000;
    const forecastHour = hour + step;
    const forecastDiurnal = Math.sin(((forecastHour - 9) / 24) * Math.PI * 2) * 5.5;
    const forecastRandom = createSeededRandom(citySeed ^ Math.floor(timestamp / WEATHER_BUCKET_MS));
    const forecastTemp = baseline + forecastDiurnal + (forecastRandom() - 0.5) * 3;
    hours.push({
      timestamp,
      temperatureC: Number(forecastTemp.toFixed(1)),
      condition: hourLabelCondition(timestamp, citySeed),
      precipitationChance: Math.round(forecastRandom() * (condition === 'rain' ? 80 : 45)),
    });
  }

  const dailyRandom = createSeededRandom(citySeed ^ Math.floor(now / 86400000));
  const highC = Number((temperatureC + 1.5 + dailyRandom() * 4).toFixed(1));
  const lowC = Number((temperatureC - 3 - dailyRandom() * 4).toFixed(1));

  const dayLength = 12 + Math.sin(((dayOfYear(date) - 172) / 365) * Math.PI * 2) * (Math.abs(latitude) / 90) * 4;
  const sunriseHour = Number((12 - dayLength / 2).toFixed(1));
  const sunsetHour = Number((12 + dayLength / 2).toFixed(1));

  return {
    city: name,
    condition,
    temperatureC: Number(temperatureC.toFixed(1)),
    feelsLikeC,
    humidity,
    windKph,
    highC,
    lowC,
    summary: CONDITION_LABELS[condition],
    sunriseHour,
    sunsetHour,
    hourly: hours,
    simulated: true,
    updatedAt: now,
  };
}

/** Convert a Celsius value into the requested unit. */
export function convertTemperature(celsius: number, unit: TemperatureUnit): number {
  return unit === 'metric' ? celsius : celsius * 1.8 + 32;
}

/** Unit suffix, e.g. `°C`. */
export function temperatureUnit(unit: TemperatureUnit): string {
  return unit === 'metric' ? '°C' : '°F';
}

/** Format a temperature for display. */
export function formatTemperature(celsius: number, unit: TemperatureUnit, digits = 0): string {
  return `${convertTemperature(celsius, unit).toFixed(digits)}°`;
}
