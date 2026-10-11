import { useEffect, useRef } from 'react';
import { useDashboardStore } from '@/store/dashboardStore';
import { useToastStore } from '@/store/toastStore';

/**
 * Say so when a stored dashboard could not be read.
 *
 * A payload that fails validation is replaced by the starter layout — which is
 * the right recovery, but it used to happen in silence, so a dashboard that had
 * been damaged looked exactly like a first visit. Renders nothing; it only fires
 * one notice.
 */
export function SeedNotice() {
  const seedOrigin = useDashboardStore((state) => state.seedOrigin);
  const warning = useToastStore((state) => state.warning);
  const announced = useRef(false);

  useEffect(() => {
    if (announced.current || seedOrigin !== 'recovered') return;
    announced.current = true;
    warning('We could not read your saved dashboard', {
      description:
        'It started again from the starter layout. If you saved a copy of this dashboard to a file, open that file to get it back.',
      duration: 12000,
    });
  }, [seedOrigin, warning]);

  return null;
}
