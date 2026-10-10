import { useEffect, useRef, useState } from 'react';
import { useDebouncedValue } from './useDebouncedValue';
import { useTimeBucket } from './useNow';
import { getWeather, type WeatherSnapshot } from '@/lib/mock/weather';
import { fetchWeather, WEATHER_REFRESH_MS, WeatherError } from '@/lib/weather';

export type WeatherSource = 'live' | 'simulated';

/** A failed lookup, kept alongside the city it belongs to. */
interface WeatherFailure {
  error: string;
}

export interface UseWeatherResult {
  weather: WeatherSnapshot;
  /** `live` when the request succeeded, `simulated` for the offline fallback. */
  source: WeatherSource;
  /** Reason the last live attempt failed, retained for the tooltip. */
  error: string | null;
  /** True while a live request is in flight and no live data is shown yet. */
  pending: boolean;
}

/**
 * Weather for a city, live first with a simulated fallback.
 *
 * The widget renders synchronously from the simulated provider and upgrades to
 * live data when the request lands, so a slow or offline network can never
 * leave the panel blank. Requests are debounced against typing, cancelled when
 * the city changes, and refreshed on a 15 minute window — the same cadence as
 * the upstream cache, which keeps traffic to a free service minimal.
 */
export function useWeather(city: string): UseWeatherResult {
  const debouncedCity = useDebouncedValue(city, 600);
  // The bucket doubles as the refresh key: one request per window, per widget.
  const bucket = useTimeBucket(WEATHER_REFRESH_MS);
  const [outcome, setOutcome] = useState<{
    /** The request this result answers — a stale reply is ignored. */
    key: string;
    result: WeatherSnapshot | WeatherFailure;
  } | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const query = debouncedCity.trim();
  // Tagging the request lets the effect ignore a reply for a city the user has
  // already navigated away from, and lets the render drop a stale snapshot.
  const requestKey = `${query.toLowerCase()}@${bucket}`;

  useEffect(() => {
    if (!query) return undefined;
    const controller = new AbortController();
    controllerRef.current = controller;
    let active = true;

    fetchWeather(query, { signal: controller.signal })
      .then((snapshot) => {
        if (active) setOutcome({ key: requestKey, result: snapshot });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        // Keep the last good snapshot on screen; only surface the reason.
        if (cause instanceof WeatherError) setOutcome({ key: requestKey, result: { error: cause.message } });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [query, requestKey]);

  // Unmounting aborts whatever is still in flight, so a widget removed from the
  // canvas stops talking to the network immediately.
  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const settled = outcome?.key === requestKey ? outcome.result : null;
  const live = settled && 'city' in settled ? settled : null;
  const error = settled && 'error' in settled ? settled.error : null;
  // Nothing live for this exact request yet: still loading, or it failed.
  const weather = live ?? getWeather(city, bucket * WEATHER_REFRESH_MS);

  return {
    weather,
    source: live ? 'live' : 'simulated',
    error,
    pending: !live && !error,
  };
}
