import { useEffect } from 'react';
import { APP_NAME } from '@/constants/app';

/**
 * Name the browser tab after the dashboard.
 *
 * Several dashboards are several files, and "Lotus Dashboard Creator" in every
 * tab, bookmark and history entry tells you nothing about which one it is.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const name = title.trim();
    document.title = name ? `${name} · Lotus` : APP_NAME;
  }, [title]);
}
