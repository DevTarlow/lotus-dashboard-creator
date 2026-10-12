import { describe, expect, it } from 'vitest';
import { parseArgs, resolveUpload } from './butler-push.mjs';

const env = { ITCH_TARGET: undefined };

describe('parseArgs', () => {
  it('needs a mode', () => {
    expect(parseArgs([], env).error).toMatch(/preview or publish/);
  });

  it('reads the mode and defaults to the Lotus project', () => {
    expect(parseArgs(['preview'], env)).toEqual({
      mode: 'preview',
      target: 'tarlow/lotus-dashboard',
      hidden: false,
      yes: false,
    });
  });

  it('lets ITCH_TARGET move the project without a flag', () => {
    expect(parseArgs(['publish'], { ITCH_TARGET: 'someone/else' }).target).toBe('someone/else');
  });

  it('refuses two modes at once', () => {
    expect(parseArgs(['preview', 'publish'], env).error).toMatch(/conflicts/);
  });

  it('refuses a target that is not user/project', () => {
    // Getting this wrong uploads to the wrong page, so it is validated rather
    // than passed through to butler.
    expect(parseArgs(['preview', '--target=lotus-dashboard'], env).error).toMatch(/user\/project/);
    expect(parseArgs(['preview', '--target=tarlow/lotus-dashboard'], env).target).toBe('tarlow/lotus-dashboard');
  });

  it('carries --hidden and --yes through', () => {
    expect(parseArgs(['publish', '--hidden', '--yes'], env)).toMatchObject({ hidden: true, yes: true });
  });

  it('refuses anything it does not understand', () => {
    expect(parseArgs(['preview', '--suffix=beta'], env).error).toMatch(/unknown argument/);
  });
});

describe('resolveUpload', () => {
  const version = '1.0.0';
  const fresh = { mtimeMs: 2_000, size: 259_000, inputs: [{ path: 'src', mtime: 1_000 }] };

  it('builds the preview argv for a fresh archive', () => {
    const { problems, spec } = resolveUpload({ mode: 'preview', target: 'tarlow/lotus-dashboard', version, archive: fresh });
    expect(problems).toEqual([]);
    expect(spec).toEqual([
      'push-preview',
      '--changes-only',
      'dist-itch/LotusDashboardCreator-1.0.0.zip',
      'tarlow/lotus-dashboard:download',
    ]);
  });

  it('builds the publish argv with the user version', () => {
    const { spec } = resolveUpload({ mode: 'publish', target: 'tarlow/lotus-dashboard', version, archive: fresh });
    expect(spec).toContain('--userversion');
    expect(spec).toContain('1.0.0');
  });

  it('says how to build the archive when there is none', () => {
    const { problems, spec } = resolveUpload({ mode: 'publish', target: 'tarlow/lotus-dashboard', version, archive: null });
    expect(spec).toBeUndefined();
    expect(problems.join(' ')).toContain('npm run itch:dist');
  });

  it('refuses to upload an archive older than the source', () => {
    const stale = { ...fresh, mtimeMs: 500, inputs: [{ path: 'src', mtime: 1_000 }] };
    const { problems, spec } = resolveUpload({ mode: 'publish', target: 'tarlow/lotus-dashboard', version, archive: stale });
    expect(spec).toBeUndefined();
    expect(problems.join(' ')).toContain('src');
  });
});
