import { describe, expect, it } from 'vitest';
import { breakTitle, plateHtml } from './itch-cover.mjs';

const SHOT = 'data:image/png;base64,SHOT';
const LOGO = 'data:image/png;base64,LOGO';
const context = { title: 'Lotus Dashboard Creator', shortDescription: 'Twenty widgets.', screenshot: SHOT, logo: LOGO };

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

  it('puts the app logo in the cover and leaves it off the banner', () => {
    // The banner has no empty corner: its words sit beside the screenshot panel.
    expect(cover.match(/<img class="logo"/g)).toHaveLength(1);
    expect(banner).not.toContain('<img class="logo"');
  });

  it('places the logo by a solved box, since the asset is mostly padding', () => {
    // `src/assets/apple-touch-icon.png` carries the mark inset inside a
    // transparent square, so the element is larger than what is seen.
    expect(cover).toMatch(/\.logo \{[^}]*right: \d+px/);
    expect(cover).toMatch(/\.logo \{[^}]*top: -?\d+px/);
  });

  it('omits the logo entirely when none is given', () => {
    const logoLess = plateHtml({ width: 630, height: 500, ...context, logo: null });
    expect(logoLess).not.toContain('<img class="logo"');
    expect(logoLess).not.toContain('undefined');
  });

  it('carries the artwork and the words, with the description escaped', () => {
    expect(cover).toContain(SHOT);
    expect(cover).toContain('Lotus Dashboard<br>Creator');
    expect(plateHtml({ width: 630, height: 500, ...context, shortDescription: 'a < b & c' })).toContain(
      'a &lt; b &amp; c',
    );
  });
});
