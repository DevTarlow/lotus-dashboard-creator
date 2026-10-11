import { describe, expect, it } from 'vitest';
import { shareablePrefs } from '@/lib/prefs';

describe('shareablePrefs', () => {
  it('carries exactly the three shareable preferences', () => {
    const prefs = shareablePrefs({ theme: 'dark', showGridHints: false, confirmDelete: true });
    expect(prefs).toEqual({ theme: 'dark', showGridHints: false, confirmDelete: true });
    expect(Object.keys(prefs).sort()).toEqual(['confirmDelete', 'showGridHints', 'theme']);
  });

  it('drops every secret, whatever else is on the object', () => {
    // The runtime object is wider than the type: this is the shape that would
    // reach a saved file if the projection ever stopped being used.
    const runtimePrefs = {
      theme: 'light' as const,
      showGridHints: true,
      confirmDelete: false,
      finnhubKey: 'ck_live_should_never_be_embedded',
      githubToken: 'ghp_should_never_be_embedded',
      updatedAt: 123,
    };

    const shared = shareablePrefs(runtimePrefs);
    const serialised = JSON.stringify(shared);

    expect(serialised).not.toContain('should_never_be_embedded');
    expect(serialised).not.toContain('finnhubKey');
    expect(serialised).not.toContain('githubToken');
    expect(serialised).not.toContain('updatedAt');
  });
});
