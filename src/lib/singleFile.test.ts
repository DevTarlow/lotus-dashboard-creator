import { describe, expect, it } from 'vitest';
import {
  dashboardFileDescription,
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
