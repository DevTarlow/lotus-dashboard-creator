import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ARCHIVE,
  BUILD_INPUTS,
  DEFAULT_TARGET,
  HTML5_REFUSAL,
  LIMITS,
  archiveProblems,
  butlerArgs,
  butlerCandidates,
  findButler,
  formatBytes,
  parseAppVersion,
  pngSize,
  releaseZipName,
  releaseZipPath,
  resolveChannel,
  staleProblems,
  versionProblems,
} from './release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A PNG header with the given dimensions, so `pngSize` can be checked cheaply. */
function pngHeader(width, height) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

const entry = (name, size = 1024) => ({ path: name, size });

describe('parseAppVersion', () => {
  it('reads the constant out of the real source file', () => {
    const source = readFileSync(path.join(root, 'src', 'constants', 'app.ts'), 'utf8');
    const version = parseAppVersion(source);
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    // The package and the app must agree, or the release script refuses.
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(version).toBe(pkg.version);
  });

  it('returns null when the constant is gone', () => {
    expect(parseAppVersion('export const APP_NAME = "Lotus";')).toBeNull();
  });
});

describe('versionProblems', () => {
  it('is quiet when the two agree', () => {
    expect(versionProblems({ packageVersion: '1.0.0', appVersion: '1.0.0' })).toEqual([]);
  });

  it('names both numbers when they drift', () => {
    const problems = versionProblems({ packageVersion: '1.0.1', appVersion: '1.0.0' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('1.0.1');
    expect(problems[0]).toContain('1.0.0');
  });

  it('reports a missing field and an unreadable constant separately', () => {
    expect(versionProblems({ packageVersion: '', appVersion: '1.0.0' })).toHaveLength(1);
    expect(versionProblems({ packageVersion: '1.0.0', appVersion: null })).toHaveLength(1);
    expect(versionProblems({ packageVersion: '', appVersion: null })).toHaveLength(2);
  });
});

describe('archive naming', () => {
  it('names the ZIP after the version and writes it to dist-itch', () => {
    expect(releaseZipName('1.2.3')).toBe('LotusDashboardCreator-1.2.3.zip');
    expect(releaseZipPath('1.2.3')).toBe('dist-itch/LotusDashboardCreator-1.2.3.zip');
  });
});

describe('staleProblems', () => {
  const inputs = BUILD_INPUTS.map((path) => ({ path, mtime: 1_000 }));

  it('is quiet when nothing moved after the build', () => {
    expect(staleProblems({ builtAt: 2_000, inputs })).toEqual([]);
  });

  it('names the inputs that changed, and says how to fix it', () => {
    const problems = staleProblems({
      builtAt: 2_000,
      inputs: [{ path: 'src', mtime: 3_000 }, ...inputs.slice(1)],
    });
    expect(problems.join(' ')).toContain('src');
    expect(problems.join(' ')).toContain('npm run itch:dist');
  });
});

describe('archiveProblems', () => {
  const good = [entry(ARCHIVE.html, 856_329), entry(ARCHIVE.startHere, 2_400), entry(ARCHIVE.licence, 1_070)];

  it('accepts exactly the three expected files', () => {
    expect(archiveProblems(good)).toEqual([]);
  });

  it('notices a missing file and an extra one', () => {
    expect(archiveProblems([good[0]])[0]).toContain(ARCHIVE.startHere);
    const withExtra = archiveProblems([...good, entry('notes.txt')]);
    expect(withExtra.join(' ')).toContain('unexpected');
  });

  it('refuses anything nested in a directory', () => {
    const problems = archiveProblems([...good.slice(1), entry(`lotus/${ARCHIVE.html}`)]);
    expect(problems.join(' ')).toContain('nested');
  });

  it('applies itch\'s documented limits', () => {
    expect(archiveProblems([...good, entry('a'.repeat(LIMITS.maxPathLength + 1))]).join(' ')).toContain('240');
    expect(archiveProblems([...good.slice(1), entry(ARCHIVE.html, LIMITS.maxFileBytes + 1)]).join(' ')).toContain(
      'per-file',
    );
  });
});

describe('resolveChannel', () => {
  it('defaults to the download channel', () => {
    expect(resolveChannel()).toBe('download');
    expect(resolveChannel('download')).toBe('download');
  });

  it('refuses html5 with the measured reasons', () => {
    expect(() => resolveChannel('html5')).toThrow(/html5/);
    expect(HTML5_REFUSAL).toContain('SecurityError');
    expect(HTML5_REFUSAL).toContain('scrolling');
  });

  it('refuses anything else by name', () => {
    expect(() => resolveChannel('windows')).toThrow(/unknown channel/);
  });
});

describe('butlerArgs', () => {
  it('previews without creating a build', () => {
    expect(butlerArgs({ mode: 'preview', source: 'dist-itch/x.zip', version: '1.0.0' })).toEqual([
      'push-preview',
      '--changes-only',
      'dist-itch/x.zip',
      `${DEFAULT_TARGET}:download`,
    ]);
  });

  it('publishes with the user version', () => {
    expect(butlerArgs({ mode: 'publish', source: 'dist-itch/x.zip', version: '1.0.0' })).toEqual([
      'push',
      'dist-itch/x.zip',
      `${DEFAULT_TARGET}:download`,
      '--userversion',
      '1.0.0',
    ]);
  });

  it('only passes --hidden when asked, so a later push is not refused', () => {
    const args = butlerArgs({ mode: 'publish', source: 'x.zip', version: '1.0.0', hidden: true });
    expect(args).toContain('--hidden');
    expect(butlerArgs({ mode: 'publish', source: 'x.zip', version: '1.0.0', hidden: false })).not.toContain('--hidden');
  });

  it('honours a target override', () => {
    const args = butlerArgs({ mode: 'preview', source: 'x.zip', version: '1.0.0', target: 'someone/other' });
    expect(args.at(-1)).toBe('someone/other:download');
  });

  it('refuses to publish without a version, and refuses an unknown mode', () => {
    expect(() => butlerArgs({ mode: 'publish', source: 'x.zip' })).toThrow(/version/);
    expect(() => butlerArgs({ mode: 'ship', source: 'x.zip', version: '1.0.0' })).toThrow(/unknown mode/);
  });

  it('cannot be pointed at html5 through the channel argument', () => {
    expect(() => butlerArgs({ mode: 'publish', source: 'x.zip', version: '1.0.0', channel: 'html5' })).toThrow(
      /html5/,
    );
  });
});

describe('finding butler', () => {
  const env = { PATH: ['/one', '/two'].join(path.delimiter), HOME: '/home/someone' };

  it('takes BUTLER_PATH first', () => {
    const candidates = butlerCandidates({ ...env, BUTLER_PATH: '/opt/butler' });
    expect(candidates[0]).toBe('/opt/butler');
  });

  it('looks on PATH, then in ~/bin, which non-interactive shells miss', () => {
    const candidates = butlerCandidates(env);
    expect(candidates).toContain(path.join('/one', 'butler'));
    expect(candidates).toContain(path.join('/home/someone', 'bin', 'butler'));
  });

  it('returns the first candidate that exists, or null', () => {
    const found = findButler(env, (candidate) => candidate === path.join('/two', 'butler'));
    expect(found).toBe(path.join('/two', 'butler'));
    expect(findButler(env, () => false)).toBeNull();
  });
});

describe('pngSize', () => {
  it('reads the plate dimensions itch asks for', () => {
    expect(pngSize(pngHeader(630, 500))).toEqual({ width: 630, height: 500 });
    expect(pngSize(pngHeader(960, 400))).toEqual({ width: 960, height: 400 });
  });

  it('returns null for something that is not a PNG', () => {
    expect(pngSize(Buffer.from('not a png at all, not even close'))).toBeNull();
    expect(pngSize(Buffer.alloc(4))).toBeNull();
    expect(pngSize(null)).toBeNull();
  });
});

describe('formatBytes', () => {
  it('reads as bytes, kilobytes and megabytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(856_329)).toBe('836 kB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
