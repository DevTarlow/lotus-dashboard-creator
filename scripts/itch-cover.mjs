#!/usr/bin/env node
/**
 * Draw the itch.io cover and banner.
 *
 *   npm run itch:cover
 *
 * itch wants a 630x500 cover image and accepts a 960x400 page header. Both are
 * drawn here from one HTML composition and captured in the same real Chrome the
 * browser checks use, so they are reproducible and need no image library, no
 * design file and no dependency the app does not already have.
 *
 * The words come from `docs/itch/metadata.json`, the same file the page fields
 * come from, so the plate cannot advertise a tagline the store page dropped. The
 * panel art is `docs/dashboard-dark.png`, the screenshot the README already
 * shows, cropped rather than shrunk: at cover size a whole dashboard scaled down
 * is a grey rectangle, while the toolbar and two cards still read.
 *
 * Written straight over the existing files. If a hand-made cover is ever wanted,
 * delete this script's output path from the run rather than editing the PNG.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, openPage, wait } from './browser/cdp.mjs';
import { pngSize } from './release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kitPath = path.join(root, 'docs', 'itch', 'metadata.json');
const artDir = path.join(root, 'docs', 'media', 'itch');

/** The two plates, at the exact sizes itch asks for. */
const PLATES = [
  { name: 'cover-630x500.png', width: 630, height: 500 },
  { name: 'banner-960x400.png', width: 960, height: 400 },
];

/**
 * Colours, taken from the app's own theme tokens rather than picked by eye:
 * `node_modules/tailwindcss/theme.css`, which `src/styles/index.css` builds on.
 */
const COLOURS = {
  ground: 'oklch(20.8% 0.042 265.755)',
  groundDeep: 'oklch(12.9% 0.042 264.695)',
  edge: 'oklch(37.2% 0.044 257.287)',
  body: 'oklch(86.9% 0.022 252.894)',
  muted: 'oklch(70.4% 0.04 256.788)',
  accent: 'oklch(60.6% 0.25 292.717)',
  accentSoft: 'oklch(81.1% 0.111 293.571)',
  ink: 'oklch(12.9% 0.042 264.695)',
};

/** The app's own font stack, so the plate looks like the product. */
const FONT =
  "'Inter var', 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}

/**
 * The title, broken once before its last word.
 *
 * "Lotus Dashboard Creator" is too long for one line at plate sizes, and letting
 * it wrap puts "Dashboard" alone on a line and "Creator" under it. Two balanced
 * lines read as a name rather than as three stacked words.
 */
export function breakTitle(title) {
  return escapeHtml(title).replace(/ (?=[^ ]+$)/, '<br>');
}

/**
 * One plate's markup.
 *
 * The two sizes get different arrangements rather than one scaled design: 630x500
 * is a poster, so the words sit above the artwork, while 960x400 is a strip, so
 * they sit beside it.
 */
export function plateHtml({ width, height, title, shortDescription, screenshot }) {
  const wide = width / height > 1.5;
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
  body {
    font-family: ${FONT};
    color: ${COLOURS.body};
    background: linear-gradient(155deg, ${COLOURS.ground} 0%, ${COLOURS.groundDeep} 72%);
    -webkit-font-smoothing: antialiased;
  }
  .glow {
    position: absolute; inset: -40% -20% auto auto; width: 70%; height: 90%;
    background: radial-gradient(closest-side, ${COLOURS.accent} 0%, transparent 100%);
    opacity: 0.28;
  }
  .plate { position: relative; width: 100%; height: 100%; display: flex; }
  .words { display: flex; flex-direction: column; justify-content: center; }
  .mark { width: 40px; height: 4px; border-radius: 2px; background: ${COLOURS.accent}; margin-bottom: 18px; }
  .eyebrow {
    font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;
    color: ${COLOURS.accentSoft}; margin-bottom: 10px;
  }
  h1 { color: #fff; font-weight: 700; letter-spacing: -0.02em; }
  p { color: ${COLOURS.muted}; }
  .shot {
    overflow: hidden; border: 1px solid ${COLOURS.edge}; border-radius: 16px;
    background-color: ${COLOURS.groundDeep}; background-repeat: no-repeat;
    box-shadow: 0 30px 70px -24px rgba(0, 0, 0, 0.8);
  }
  ${
    wide
      ? `
  .plate { align-items: center; gap: 34px; padding: 0 0 0 46px; }
  .words { width: 372px; flex: none; }
  h1 { font-size: 37px; line-height: 1.08; }
  p { font-size: 14.5px; line-height: 1.45; margin-top: 14px; }
  .shot {
    flex: 1 1 auto; height: 100%; margin: 26px -60px -60px 0;
    border-radius: 16px 0 0 0; background-size: 175%; background-position: 0 0;
  }`
      : `
  .plate { flex-direction: column; padding: 38px 38px 0; }
  .words { flex: none; }
  h1 { font-size: 38px; line-height: 1.06; }
  p { font-size: 14.5px; line-height: 1.45; margin-top: 13px; }
  .shot {
    flex: 1 1 auto; margin: 26px -38px -40px; border-radius: 16px 16px 0 0;
    background-size: 210%; background-position: 0 8%;
  }`
  }
</style></head>
<body>
  <div class="glow"></div>
  <div class="plate">
    <div class="words">
      <div class="mark"></div>
      <div class="eyebrow">One HTML file &middot; nothing to install</div>
      <h1>${breakTitle(title)}</h1>
      <p>${escapeHtml(shortDescription)}</p>
    </div>
    <div class="shot" style="background-image: url('${screenshot}')"></div>
  </div>
</body></html>`;
}

/** Draw one plate and return its PNG bytes. */
async function capture(session, plate, context) {
  const html = plateHtml({ ...plate, ...context });
  const tree = await session.send('Page.getFrameTree');
  await session.send('Page.setDocumentContent', { frameId: tree.frameTree.frame.id, html });
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: plate.width,
    height: plate.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait(250);
  // The artwork is a data URI, so it decodes immediately, but decoding is still
  // asynchronous: capture before it finishes and the panel comes out empty.
  await session.evaluate(
    `Promise.all([...document.images].map((image) => image.decode().catch(() => {}))).then(() => true)`,
  );
  const shot = await session.send('Page.captureScreenshot', { format: 'png' });
  return Buffer.from(shot.data, 'base64');
}

async function main() {
  const kit = JSON.parse(await readFile(kitPath, 'utf8'));
  if (!kit.title || !kit.shortDescription) {
    throw new Error(`${path.relative(root, kitPath)} needs a title and a shortDescription to draw.`);
  }

  const screenshotPath = path.join(root, 'docs', 'dashboard-dark.png');
  const screenshot = `data:image/png;base64,${(await readFile(screenshotPath)).toString('base64')}`;
  const context = { title: kit.title, shortDescription: kit.shortDescription, screenshot };

  await mkdir(artDir, { recursive: true });

  const chrome = await launchChrome();
  try {
    const page = await openPage(chrome.port, 'about:blank');
    try {
      for (const plate of PLATES) {
        const png = await capture(page.session, plate, context);
        // Assert the plate, rather than trusting the canvas that drew it: itch
        // rejects a cover that is not exactly 630x500, at upload time.
        const size = pngSize(png);
        if (size?.width !== plate.width || size?.height !== plate.height) {
          throw new Error(
            `${plate.name} came out ${size ? `${size.width}x${size.height}` : 'not a PNG'}, expected ${plate.width}x${plate.height}`,
          );
        }
        const target = path.join(artDir, plate.name);
        await writeFile(target, png);
        console.log(`${path.relative(root, target)}  (${plate.width}x${plate.height}, ${Math.round(png.length / 1024)} kB)`);
      }
    } finally {
      await page.close();
    }
  } finally {
    await chrome.close();
  }
  console.log('\nthe cover is required by itch; the banner is optional. Both are safe to replace by hand.');
}

main().catch((error) => {
  console.error(`\nitch:cover failed — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
