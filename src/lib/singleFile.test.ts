import { describe, expect, it } from 'vitest';
import {
  dashboardFileDescription,
  preferredSaveName,
  suggestedDashboardFileName,
} from '@/lib/singleFile';

describe('suggestedDashboardFileName', () => {
  it('slugifies the dashboard title', () => {
    expect(suggestedDashboardFileName('Ops wall')).toBe('lotus-dashboard-ops-wall.html');
  });

  it('strips punctuation and collapses separators', () => {
    expect(suggestedDashboardFileName('  My   “Ops” / wall!  ')).toBe('lotus-dashboard-my-ops-wall.html');
  });

  it('falls back to a plain name for an empty title', () => {
    expect(suggestedDashboardFileName('   ')).toBe('lotus-dashboard.html');
  });

  it('is undated, so re-saving overwrites the same file', () => {
    expect(suggestedDashboardFileName('Ops wall')).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('keeps long titles bounded', () => {
    const name = suggestedDashboardFileName('x'.repeat(200));
    expect(name.length).toBeLessThanOrEqual('lotus-dashboard-'.length + 40 + '.html'.length);
  });
});

describe('dashboardFileDescription', () => {
  it('names the dashboard', () => {
    expect(dashboardFileDescription('Ops wall')).toContain('Ops wall');
  });

  it('handles a blank title', () => {
    expect(dashboardFileDescription('  ')).toContain('Untitled');
  });
});

describe('preferredSaveName', () => {
  const DISK = { protocol: 'file:', pathname: '/home/me/dashboards/ops-wall.html' };

  it('proposes the file the dashboard was opened from', () => {
    // The bug this guards: naming the copy after the dashboard title sent a
    // received dashboard to the downloads folder, leaving the sent file stale.
    expect(preferredSaveName('Someone else’s desk', DISK)).toBe('ops-wall.html');
  });

  it('accepts .htm as well as .html', () => {
    expect(preferredSaveName('x', { protocol: 'file:', pathname: '/tmp/dash.htm' })).toBe('dash.htm');
  });

  it('slugifies the title on the web and in tests without a location', () => {
    expect(preferredSaveName('Ops wall', { protocol: 'https:', pathname: '/' })).toBe('lotus-dashboard-ops-wall.html');
    expect(preferredSaveName('Ops wall', undefined)).toBe('lotus-dashboard-ops-wall.html');
  });

  it('falls back to the title when the open document is not an HTML file', () => {
    expect(preferredSaveName('Ops wall', { protocol: 'file:', pathname: '/home/me/notes.txt' })).toBe(
      'lotus-dashboard-ops-wall.html',
    );
  });
});
