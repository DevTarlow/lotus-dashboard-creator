import type { ReactNode } from 'react';
import type { WeatherCondition } from '@/lib/mock/weather';
import { cn } from '@/lib/utils';

export interface WeatherGlyphProps {
  condition: WeatherCondition;
  className?: string;
}

const SUN = (
  <>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 3.2v1.8M12 19v1.8M4.4 4.4l1.3 1.3M18.3 18.3l1.3 1.3M3.2 12H5M19 12h1.8M4.4 19.6l1.3-1.3M18.3 5.7l1.3-1.3" />
  </>
);

const CLOUD = <path d="M8 18.5a3.8 3.8 0 0 1 .4-7.6 4.9 4.9 0 0 1 9.4 1.3A3.2 3.2 0 0 1 17.2 18.5H8Z" />;

const GLYPHS: Record<WeatherCondition, ReactNode> = {
  clear: SUN,
  'partly-cloudy': (
    <>
      <circle cx="8.6" cy="8.6" r="3.1" />
      <path d="M8.6 3.4v1.4M3.4 8.6h1.4M4.9 4.9l1 1" />
      <path d="M10.5 18.6a3.3 3.3 0 0 1 .4-6.6 4.3 4.3 0 0 1 8.2 1.1 2.8 2.8 0 0 1-.6 5.5h-8Z" />
    </>
  ),
  cloudy: (
    <>
      {CLOUD}
      <path d="M6.5 13.6a3 3 0 0 1 .3-5.9 3.9 3.9 0 0 1 7.4 1" />
    </>
  ),
  drizzle: (
    <>
      {CLOUD}
      <path d="M9.5 20.4v1.2M13.5 20.4v1.2M17 20.4v1.2" />
    </>
  ),
  rain: (
    <>
      {CLOUD}
      <path d="M9 20.5 8 23M13 20.5 12 23M17 20.5 16 23" />
    </>
  ),
  sleet: (
    <>
      {CLOUD}
      <path d="M9.5 20.5 8.5 23M16.5 20.5 15.5 23" />
      <path d="M13 21.2h.01" />
    </>
  ),
  storm: (
    <>
      {CLOUD}
      <path d="m13.4 19.4-2.2 2.4h3.3l-2 2.6" />
    </>
  ),
  snow: (
    <>
      {CLOUD}
      <path d="M9 20.6h.01M13 22.2h.01M17 20.6h.01" />
    </>
  ),
  fog: (
    <>
      {CLOUD}
      <path d="M6 20.2h12M8 22.4h8" />
    </>
  ),
};

/** Minimal condition glyph — one path set per weather condition. */
export function WeatherGlyph({ condition, className }: WeatherGlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('h-6 w-6', className)}
      aria-hidden="true"
    >
      {GLYPHS[condition]}
    </svg>
  );
}
