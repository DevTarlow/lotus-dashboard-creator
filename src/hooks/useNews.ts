import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTimeBucket } from './useNow';
import type { NewsArticle, NewsTopic } from '@/lib/mock/news';
import { getNewsFeed } from '@/lib/mock/news';
import { fetchNews, NEWS_REFRESH_MS, NewsError, type NewsResult } from '@/lib/news';

export type NewsSource = 'live' | 'simulated';

/** A failed refresh, kept so the footer can explain the fallback. */
interface NewsFailure {
  error: string;
}

/** The answer to one exact request — a live list, or the reason there is none. */
interface NewsOutcome {
  /** The request this answers; a reply for a stale key is ignored. */
  key: string;
  result: NewsResult | NewsFailure;
}

/** The most recent live list, which may outlive the request that produced it. */
interface NewsCache {
  topic: NewsTopic | 'all';
  limit: number;
  result: NewsResult;
}

export interface UseNewsResult {
  /** Live headlines when a provider answered, otherwise the simulated feed. */
  articles: NewsArticle[];
  /** `live` when a provider answered, `simulated` for the offline fallback. */
  source: NewsSource;
  /** Providers that contributed to the visible list. */
  providers: string[];
  /** Providers that did not answer while others did. */
  failed: string[];
  /** Reason the last refresh failed, retained for the footer. */
  error: string | null;
  /** True while the first request for this topic is still in flight. */
  pending: boolean;
  /** Force a refetch now instead of waiting for the refresh window. */
  refresh: () => void;
}

/**
 * Headlines for a topic, live first with a labelled simulated fallback.
 *
 * The widget always has something to render: the simulated provider is a pure
 * function of the clock, so the panel is never blank, and it is only ever shown
 * under the **Simulated** badge. Requests are re-made when the topic changes, on
 * a 15 minute window, and when the user hits refresh; a stale reply is ignored,
 * and a widget removed from the canvas aborts whatever is in flight.
 */
export function useNews(topic: NewsTopic | 'all', limit: number): UseNewsResult {
  // The bucket doubles as the refresh key: one round of requests per window.
  const bucket = useTimeBucket(NEWS_REFRESH_MS);
  const [refreshKey, setRefreshKey] = useState(0);
  const [outcome, setOutcome] = useState<NewsOutcome | null>(null);
  /** Kept in state, not a ref: a failed refresh must not blank the panel. */
  const [cache, setCache] = useState<NewsCache | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // Tagging the request lets the render ignore a reply for a topic, page size or
  // refresh window the user has already moved away from.
  const requestKey = `${topic}:${limit}:${bucket}:${refreshKey}`;

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    let active = true;

    fetchNews({ topic, limit, signal: controller.signal })
      .then((result) => {
        if (!active) return;
        setOutcome({ key: requestKey, result });
        setCache({ topic, limit, result });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setOutcome({
          key: requestKey,
          result: {
            error: cause instanceof NewsError ? cause.message : 'Live headlines are unavailable.',
          },
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [topic, limit, requestKey]);

  // Unmounting aborts whatever is still in flight, so a widget removed from the
  // canvas stops talking to four providers immediately.
  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const settled = outcome?.key === requestKey ? outcome.result : null;
  const answered = settled !== null && 'articles' in settled ? settled : null;
  // Only a live list for this exact topic and page size may outlive its request.
  const retained = cache?.topic === topic && cache.limit === limit ? cache.result : null;
  const current = answered ?? retained;
  const error = settled !== null && 'error' in settled ? settled.error : null;
  const fallback = useMemo(
    () => getNewsFeed({ topic, limit, now: bucket * NEWS_REFRESH_MS }),
    [topic, limit, bucket],
  );

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  return {
    articles: current?.articles ?? fallback,
    source: current === null ? 'simulated' : 'live',
    providers: current?.providers ?? [],
    failed: current?.failed ?? [],
    error,
    pending: settled === null && retained === null,
    refresh,
  };
}
