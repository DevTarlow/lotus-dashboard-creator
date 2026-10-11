import { describe, expect, it } from 'vitest';
import { BREAKPOINT_ORDER } from '@/constants/grid';
import { createDashboardDocument, serializeDashboardDocument, suggestedFileName } from '@/lib/document';
import { placeWidget } from '@/lib/grid';
import { parseDashboardJson, validateDashboardDocument } from '@/lib/validation';
import type { StoredWidgetInstance } from '@/types';

const widget: StoredWidgetInstance = {
  id: 'clock_1',
  type: 'clock',
  title: 'Clock',
  config: { hour12: true },
  createdAt: 1_700_000_000_000,
};

const layouts = placeWidget({}, { id: 'clock_1', size: { w: 3, h: 6 } }, undefined, { breakpoint: 'lg', x: 0, y: 0 });

const document = createDashboardDocument({
  title: 'Test board',
  description: 'for tests',
  widgets: [widget],
  layouts,
  exportedAt: '2026-01-01T00:00:00.000Z',
});

describe('document export', () => {
  it('serialises a valid, self describing payload', () => {
    const text = serializeDashboardDocument(document);
    expect(text.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.format).toBe('lotus-dashboard/v1');
    expect(parsed.version).toBe(1);
    expect((parsed.grid as { columns: Record<string, number> }).columns.lg).toBe(12);
  });

  it('round-trips through the validator without loss', () => {
    const result = parseDashboardJson(serializeDashboardDocument(document));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.document.dashboard.title).toBe('Test board');
    expect(result.document.widgets).toEqual([widget]);
    for (const breakpoint of BREAKPOINT_ORDER) {
      expect(result.document.layouts[breakpoint]?.map((item) => item.i)).toEqual(['clock_1']);
    }
  });

  it('builds a safe file name', () => {
    expect(suggestedFileName('My Dashboard!', new Date('2026-02-03T10:00:00Z'))).toBe(
      'lotus-dashboard-my-dashboard-2026-02-03.json',
    );
    expect(suggestedFileName('', new Date('2026-02-03T10:00:00Z'))).toBe('lotus-dashboard-2026-02-03.json');
  });
});

describe('document import', () => {
  it('rejects broken JSON with a readable message', () => {
    const result = parseDashboardJson('{ not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain('could not be read as a dashboard backup');
    // Ordinary bad JSON is *not* reported as a recognised file kind.
    expect(result.detectedAs).toBeUndefined();
  });

  it('explains a "Save to file" dashboard instead of quoting a JSON parse error', () => {
    const saved = [
      '<!doctype html>',
      '<html lang="en"><head><title>Lotus</title></head><body>',
      '<script type="application/json" id="lotus-embedded-workspace">{"format":"lotus-embedded/v1"}</script>',
      '</body></html>',
    ].join('\n');
    const result = parseDashboardJson(saved);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detectedAs).toBe('saved-dashboard-html');
    expect(result.errors[0]).toContain('dashboard file, not a backup');
    expect(result.errors[0]).not.toContain('Unexpected token');
  });

  it('recognises some other web page as markup rather than bad JSON', () => {
    const result = parseDashboardJson('<!doctype html><html><body>not ours</body></html>');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detectedAs).toBe('html');
    expect(result.errors[0]).toContain('web page');
  });

  it('rejects an empty file and a foreign format', () => {
    expect(parseDashboardJson('   ').ok).toBe(false);
    const foreign = validateDashboardDocument({ format: 'other/v9', widgets: [], layouts: {} });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.errors[0]).toContain('different app');
  });

  it('rejects documents from a newer schema', () => {
    const result = validateDashboardDocument({ format: 'lotus-dashboard/v1', version: 99, widgets: [], layouts: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('newer version');
  });

  it('clamps out-of-range layout items and drops malformed ones', () => {
    const result = validateDashboardDocument({
      format: 'lotus-dashboard/v1',
      version: 1,
      widgets: [{ id: 'a', type: 'clock', config: {} }],
      layouts: {
        lg: [
          { i: 'a', x: 40, y: -3, w: 99, h: 0 },
          { i: '', x: 0, y: 0, w: 1, h: 1 },
          { nope: true },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = result.document.layouts.lg?.[0];
    expect(item).toMatchObject({ i: 'a', x: 0, y: 0, w: 12, h: 1 });
    expect(result.warnings.some((warning) => warning.includes('did not make sense'))).toBe(true);
  });

  it('keeps unknown widget types but warns about them', () => {
    const result = validateDashboardDocument(
      {
        format: 'lotus-dashboard/v1',
        version: 1,
        widgets: [{ id: 'x', type: 'plugin.not-installed', config: { a: 1 } }],
        layouts: { lg: [{ i: 'x', x: 0, y: 0, w: 3, h: 3 }] },
      },
      { isKnownType: (type) => type === 'clock', defaultConfigFor: () => ({ hour12: false }) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.widgets).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.includes('not part of this copy'))).toBe(true);
  });

  it('merges widget defaults underneath the imported config', () => {
    const result = validateDashboardDocument(
      {
        widgets: [{ id: 'c', type: 'clock', config: { hour12: true } }],
        layouts: {},
      },
      { defaultConfigFor: () => ({ hour12: false, showSeconds: true }), displayNameFor: () => 'Clock' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.widgets[0]?.config).toEqual({ hour12: true, showSeconds: true });
    expect(result.document.widgets[0]?.title).toBe('Clock');
    // Missing format marker is tolerated, with a warning.
    expect(result.warnings.some((warning) => warning.includes('does not say what wrote it'))).toBe(true);
  });

  it('places widgets that have no layout entry', () => {
    const result = validateDashboardDocument({
      format: 'lotus-dashboard/v1',
      version: 1,
      widgets: [{ id: 'a', type: 'clock' }],
      layouts: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const breakpoint of BREAKPOINT_ORDER) {
      expect(result.document.layouts[breakpoint]?.map((item) => item.i)).toEqual(['a']);
    }
  });

  it('replaces duplicate ids instead of dropping widgets', () => {
    const result = validateDashboardDocument({
      widgets: [
        { id: 'dup', type: 'clock' },
        { id: 'dup', type: 'weather' },
      ],
      layouts: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.document.widgets.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(2);
    expect(result.warnings.some((warning) => warning.includes('same identifier'))).toBe(true);
  });
});
