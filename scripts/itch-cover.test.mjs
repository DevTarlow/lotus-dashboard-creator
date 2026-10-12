import { describe, expect, it } from 'vitest';
import { breakTitle, plateHtml } from './itch-cover.mjs';

const SHOT = 'data:image/png;base64,SHOT';
const LOGO = 'data:image/png;base64,LOGO';
const ICON = 'data:image/png;base64,ICON';
const context = {
  title: 'Lotus Dashboard Creator',
  shortDescription: 'Twenty widgets.',
  screenshot: SHOT,
  logo: LOGO,
  icon: ICON,
};

const cover = plateHtml({ width: 630, height: 500, ...context });
const banner = plateHtml({ width: 960, height: 400, ...context });

describe('breakTitle', () => {
  it('breaks once, before the last word', () => {
    expect(breakTitle('Lotus Dashboard Creator')).toBe('Lotus Dashboard<br>Creator');
  });

  it('escapes what it is given, and leaves a single word alone', () => {
    expect(breakTitle('Lotus & Co')).toBe('Lotus &amp;<br>Co');
    expect(breakTitle('Lotus')).toBe('Lotus');
  });
});

describe('plateHtml', () => {
  it('draws the cover as a poster and the banner as a strip', () => {
    // The two sizes get different arrangements, not one design scaled.
    expect(cover).toContain('flex-direction: column');
    expect(banner).toContain('align-items: center');
  });

  it('gives each plate the lotus its shape can hold', () => {
    // The poster has an empty corner for the big mark; the banner's words sit
    // beside the artwork, so it leads them with a small one instead.
    expect(cover.match(/<img class="logo"/g)).toHaveLength(1);
    expect(cover).not.toContain('<img class="icon"');
    expect(banner.match(/<img class="icon"/g)).toHaveLength(1);
    expect(banner).not.toContain('<img class="logo"');
  });

  it('places the logo by a solved box, since the asset is mostly padding', () => {
    // `src/assets/apple-touch-icon.png` carries the mark inset inside a
    // transparent square, so the element is larger than what is seen.
    expect(cover).toMatch(/\.logo \{[^}]*right: \d+px/);
    expect(cover).toMatch(/\.logo \{[^}]*top: -?\d+px/);
  });

  it('falls back to the accent bar when no logo is given', () => {
    const bare = { ...context, logo: null, icon: null };
    const coverBare = plateHtml({ width: 630, height: 500, ...bare });
    const bannerBare = plateHtml({ width: 960, height: 400, ...bare });
    expect(coverBare).not.toContain('<img class="logo"');
    expect(bannerBare).not.toContain('<img class="icon"');
    expect(bannerBare).toContain('<div class="mark"></div>');
    expect(coverBare).not.toContain('undefined');
  });

  it('carries the artwork and the words, with the description escaped', () => {
    expect(cover).toContain(SHOT);
    expect(cover).toContain('Lotus Dashboard<br>Creator');
    expect(plateHtml({ width: 630, height: 500, ...context, shortDescription: 'a < b & c' })).toContain(
      'a &lt; b &amp; c',
    );
  });
});
