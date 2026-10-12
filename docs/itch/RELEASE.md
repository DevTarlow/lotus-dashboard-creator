# itch.io release kit

Everything needed to publish **Lotus Dashboard Creator 1.0.0** on itch.io. The copy below is ready
to paste, the artwork is in [`docs/media/itch/`](../media/itch/), and the commands are at the end.

The page fields also live in [`metadata.json`](metadata.json), which
[`scripts/itch-cover.mjs`](../../scripts/itch-cover.mjs) reads so the cover art and the page cannot
disagree about the name or the tagline.

> **Read §1 first.** This page is a **free download**, and it stays that way. The artifact is the
> single HTML file in the ZIP, and that decides how the page is configured.

---

## 1. Downloadable, never "HTML Game"

| Artifact | Built by | Goes to itch as | Who can use it |
|---|---|---|---|
| `LotusDashboardCreator-1.0.0.zip` (259 kB) | `npm run itch:dist` | Downloadable file | Anyone |
| …containing `lotus-dashboard.html` (836 kB) | the same build | the app itself | Anyone |

It ships as one HTML file the reader double-clicks: the whole dashboard, offline, in any browser.
Nothing to install, no account, no server of ours in the middle.

**Keep "Kind of Game" set to `Downloadable`.** Setting it to `HTML Game` moves the app inside
itch's own iframe, where it is measurably broken. Measured against the built file in a cross-origin
frame carrying itch's real attributes (`scrolling="no"`, no `sandbox`):

| What the embed breaks | What happens |
|---|---|
| **Save to file** | `showSaveFilePicker()` throws `SecurityError: Cross origin sub frames aren't allowed to show a file picker`. The same click at top level reaches the picker normally. Saving is the product's whole promise: it is how a dashboard becomes a file you keep and send. |
| **Copy buttons** | `clipboard-write` is `denied` by the iframe's permissions policy, so copying a sticky note fails. |
| **The workspace itself** | itch sets `scrolling="no"`, and Chrome honours it. The app is 1297 px tall; in a 520 px frame the lower panels cannot be scrolled into view. |

`scripts/butler-push.mjs` refuses the `html5` channel by name, so this cannot be undone by a typo.

---

## 2. Page fields

| Field | Value |
|---|---|
| **Title** | Lotus Dashboard Creator |
| **Project URL** | `lotus-dashboard` → <https://tarlow.itch.io/lotus-dashboard> |
| **Short description / tagline** | Twenty widgets on one screen, in one HTML file. Drag, resize and arrange it the way you work, and your dashboard saves itself into the file you keep. |
| **Classification** | Tool |
| **Kind of Game** | **Downloadable** (see §1) |
| **Genre** | leave unset — itch's genre list is a game taxonomy |
| **Release status** | Released |
| **Version** | `1.0.0`, from `package.json`; butler stamps it as the build's user-version |
| **Platforms** | Windows, macOS, Linux (one file; the browser is what matters) |
| **Pricing** | Free (see §6) |
| **Cover image** | `docs/media/itch/cover-630x500.png` (630×500, required) |
| **Banner** | `docs/media/itch/banner-960x400.png` (960×400, optional page header) |
| **Mobile Friendly** | **Off** — the layout is a 12-column desktop grid |
| **Support contact** | `tarlow@mossaistudio.com`, visible on the page and not only in the app |

### Tags

Pick up to 10. Recommended, in priority order:

```
dashboard, productivity, tool, widgets, offline, browser, html, no-install
```

Adjacent tags that also fit: `self-hosted`, `privacy`, `desktop`, `utility`. Avoid `html5` and
`webgl`; itch reads those as a playable build, which this page is not.

---

## 3. Description (paste into the itch description editor)

itch accepts a limited HTML subset: headings, paragraphs, lists, bold, italic, links and images.
This is written for that subset.

```html
<h2>Twenty widgets on one screen</h2>

<p>
  Most of us keep the day scattered across a dozen tabs: the weather in one, a checklist in
  another, prices, headlines, and the thing you meant to do at four. <strong>Lotus Dashboard
  Creator</strong> gives you one screen to put them on, and you decide what goes where.
</p>

<p>
  Drag a card to move it. Pull its right or bottom edge to resize it and the cards around it close
  the gap. If the weather panel is the one you actually look at, make it wide and push the rest
  out of the way. Each screen size keeps its own arrangement, so the layout you make on a laptop
  never overwrites the one you made on a monitor.
</p>

<h3>One file, and it stays yours</h3>

<p>
  The whole app is a single HTML file, about 840 kB. Download it, put it somewhere you will find
  it again, and double-click it. There is nothing to install and no account to make, and after
  that first download it works with the wifi switched off.
</p>

<p>
  Your work is kept in the browser as you go. Press Ctrl+S (Cmd+S on macOS), or use <strong>Save
  to file</strong>, and the dashboard is written into the file as well. That file is the copy you
  keep and the copy you send someone. Chrome and Edge rewrite the file you already have; Firefox
  and Safari download a fresh copy.
</p>

<h3>What you can put on it</h3>

<ul>
  <li><strong>Clock</strong> and <strong>World clock</strong>: live time in any time zone, and
      several zones at once with each one's offset, the date it is on, an office-hours tint and a
      24-hour strip showing the windows you share.</li>
  <li><strong>Weather</strong>: a live forecast from wttr.in with no key needed, an hourly outlook
      and the details. It asks which city you want.</li>
  <li><strong>Sun &amp; moon</strong>: sunrise, sunset, solar noon, golden hour, civil twilight and
      how much daylight you gained or lost, worked out on your own machine, with the moon phase
      beside it.</li>
  <li><strong>Tasks</strong>: a checklist with priorities, due dates, reordering, a progress bar
      and "clear completed". Every edit is one undo step.</li>
  <li><strong>Focus timer</strong>: pomodoro and stopwatch in one card. It counts from timestamps
      rather than ticking a counter, so a background tab cannot make it drift and a reload resumes
      a running phase.</li>
  <li><strong>Habit streaks</strong>: today's ticks, current and best streaks, and a heatmap
      covering four to twelve weeks. A habit you have not done yet today never breaks its streak.</li>
  <li><strong>Calendar</strong> and <strong>Countdown</strong>: a month grid with ISO week numbers,
      events you edit inline and optional public holidays; and the dates worth waiting for, with
      annual rollover.</li>
  <li><strong>Markdown notes</strong> and <strong>Sticky notes</strong>: a multi-note editor with a
      file panel, draggable dividers and edit / split / preview modes; and quick post-its in five
      colours you can pin, copy and recolour.</li>
  <li><strong>Quick links</strong>: a bookmark launcher with site icons, which fall back to an
      initials chip when there is no icon. Add, edit, remove and reorder inline.</li>
  <li><strong>Market ticker</strong>: live crypto prices from CoinGecko with no key needed, and
      live stock prices through your own free Finnhub key.</li>
  <li><strong>News feed</strong> and <strong>On this day</strong>: headlines from Hacker News, DEV
      Community, Spaceflight News and Wikipedia's current-events desk; and curated highlights for
      today's date from the Wikimedia feeds.</li>
  <li><strong>Air quality &amp; UV</strong> and <strong>Seismic watch</strong>: the US AQI with a
      twelve-hour strip, the UV index and its peak; and recent earthquakes from the USGS feeds,
      filtered by magnitude, time window and radius.</li>
  <li><strong>Converter</strong>: eleven categories of unit conversion, temperature scales
      included, and currency at the ECB reference rate with a 30-day history.</li>
  <li><strong>System &amp; device</strong> and <strong>Repository</strong>: connection, battery,
      browser storage, screen and uptime, read locally; and stars, forks, issues and the latest
      release for a GitHub repository.</li>
</ul>

<h3>Where the live data comes from</h3>

<p>
  Weather comes from wttr.in, crypto from CoinGecko, headlines from Hacker News, DEV, Spaceflight
  News and Wikipedia, holidays from Nager.Date, earthquakes from USGS, air quality and place
  lookups from Open-Meteo, and currency rates from Frankfurter. None of those need a key. Each card
  says along its bottom edge whether it is showing live data, a saved copy, or nothing at all, and
  a panel that cannot reach its source says so rather than inventing a number.
</p>

<h3>Offline, and what stays on your machine</h3>

<p>
  There is no server of ours in the middle and nothing to sign up for. Weather, prices and the news
  feed show a reading clearly marked <strong>Simulated</strong> when they cannot reach their
  source. A Finnhub key for stock prices and an optional GitHub key are kept in your browser, sent
  only to that one service, and left out of any file you save or send. The one widget that sends
  something about you is <strong>System &amp; device</strong>'s public-address lookup, which is off
  until you turn it on and says what it sends.
</p>

<h3>Requirements</h3>

<p>
  Chrome, Edge, Firefox or Safari, on Windows, macOS or Linux. The dashboard is a 12-column grid,
  so it wants a window with some width to it. It runs from the file itself: there is nothing to
  keep updated, and no service of ours that can go down.
</p>

<p>
  MIT licensed, and the dashboards you build are yours to use however you like.
</p>
```

---

## 4. Screenshots

Upload in this order. itch shows the first one as the page hero. Every file already exists in
`docs/` and is a real capture of the app, not a mock-up.

| # | File | Size | Caption |
|---|---|---|---|
| 1 | [`docs/dashboard-dark.png`](../dashboard-dark.png) | 1680×1050 | The dashboard as it opens: a six-panel starter with the clock, weather, quick links, tasks, a calendar and notes. |
| 2 | [`docs/widget-gallery.png`](../widget-gallery.png) | 1680×1050 | The Add widget panel: twenty widgets, a live preview of each, and the size you want to drop it at. |
| 3 | [`docs/themes.png`](../themes.png) | 1680×1050 | Seven themes in light and dark, and a contrast solver for the colours you pick yourself. |
| 4 | [`docs/welcome.png`](../welcome.png) | 1680×1050 | The first-run welcome, which explains where your dashboard is kept. Press ? to bring it back at any time. |
| 5 | [`docs/dashboard-light.png`](../dashboard-light.png) | 1680×1050 | The same workspace in the light theme. |

itch accepts these at 16:10 and scales them; there is no need to re-cut them to 16:9.

### Cover and banner

```bash
npm run itch:cover     # rewrites both files from docs/itch/metadata.json
```

* `cover-630x500.png` is required and is what appears in browse listings.
* `banner-960x400.png` is optional and goes at the top of the page.

Both are drawn by `scripts/itch-cover.mjs` in the same Chrome the browser checks use: the words
come from `metadata.json`, the panel art is `docs/dashboard-dark.png` cropped rather than shrunk,
and the colours are the app's own theme tokens. Running it again overwrites whatever is there, so
replace the script's composition rather than hand-editing the PNG if you want a different cover.

---

## 5. Release notes (paste into the itch devlog post)

Open the post with `docs/dashboard-dark.png` or the cover. A launch post reads better with the
product at the top of it.

```html
<h2>Lotus Dashboard Creator 1.0.0 is out</h2>

<p>
  It is one HTML file you download, double-click, and use from then on. Twenty widgets, one screen,
  and no account anywhere.
</p>

<p>
  Put a clock, the weather, your tasks, a calendar, notes, prices and headlines on the same page,
  then arrange them until it suits you. Drag a card to move it, pull an edge to resize it, and the
  cards around it close the gap.
</p>

<h3>What is in 1.0.0</h3>

<ul>
  <li>Twenty widgets: clock and world clock, weather, sun and moon, tasks, focus timer, habit
      streaks, calendar, countdown, markdown notes, sticky notes, quick links, market ticker, news
      feed, on this day, air quality and UV, seismic watch, converter, system and device, and
      repository.</li>
  <li>Drag, resize and reorder on a 12-column grid, with a separate layout for every screen size.</li>
  <li>Seven saved templates, from a six-panel starter to a sixteen-panel workspace, plus a blank
      canvas.</li>
  <li>Seven themes in light and dark, with a contrast solver for the colours you pick yourself.</li>
  <li>Save to file writes your whole dashboard into the HTML file, so the copy you keep and the copy
      you send are the same one.</li>
  <li>Works offline, with a clearly marked simulated reading from the panels that need a connection.</li>
  <li>API keys stay in your browser and never travel inside a saved file.</li>
</ul>

<p>
  It is free, MIT licensed, and the dashboards you build are yours. If it earns a place on your
  screen, tell me what is missing.
</p>
```

---

## 6. Pricing

**Free.** The app is MIT licensed and the same file is on
[GitHub](https://github.com/DevTarlow/lotus-dashboard-creator/releases/latest), so charging for it
here would only make the itch copy the lesser one.

ich can take donations on a free page if you want the option. Leave the minimum at zero: the page
copy promises a free file, and a price takes the page out of "Downloadable" and into a payment
flow it does not need.

Support address on the page: `tarlow@mossaistudio.com`.

---

## 7. Build the upload

```bash
npm run verify        # typecheck, lint, tests, build, single-file build

npm run itch:dist     # rebuild, package, verify the archive
npm run itch:preview  # what a butler push would change; uploads nothing
npm run itch:publish  # asks for confirmation, then uploads

npm run itch:cover    # redraw the cover and banner
```

`npm run itch:dist` rebuilds the single-file app, stages it with `packaging/START HERE.txt` and the
licence, zips them, and then verifies the archive by reading it back: the three file names, the app
byte for byte against `dist-single/index.html`, and itch's documented size limits. A failing check
deletes the ZIP so a broken one cannot look publishable. It also refuses a build older than the
source, so the archive can never hold last week's app.

### Option A — upload in the browser

1. Upload `dist-itch/LotusDashboardCreator-1.0.0.zip` to the page.
2. **Kind of Game** — confirm it says **Downloadable** and not *HTML Game*. See §1.
3. Set it as the Windows, macOS and Linux download. One file covers all three.

### Option B — butler

```bash
# once
butler login

npm run itch:preview     # shows exactly what would be uploaded
npm run itch:publish     # asks first, then uploads
```

The channel is `download` and the artifact is a single ZIP. One ZIP is one opaque file to butler,
so an update re-sends the whole archive instead of sending a diff. At 259 kB that is not worth
fixing.

If butler is not on `PATH`, set `BUTLER_PATH=/path/to/butler`. itch's own installer writes it to
`~/bin`, which non-interactive shells routinely leave off `PATH`.

To publish somewhere other than `tarlow/lotus-dashboard`, pass `--target=user/project` or set
`ITCH_TARGET`. For a first push you can add `--hidden` to keep the build off the page while you
check it; later pushes to the same channel must omit it.

---

## 8. Before you hit publish

- [x] `npm run verify` green.
- [x] `npm run itch:dist` green (`dist-itch/LotusDashboardCreator-1.0.0.zip`, three files, 259 kB).
- [x] The ZIP's `lotus-dashboard.html` is byte-identical to `dist-single/index.html`.
- [x] `npm run verify:browser -- --single=<extracted>/lotus-dashboard.html` green — 117 checks
      against the file **unzipped from this archive**, at a different path, so the shipped copy is
      the one the browser suite vouches for. Re-run this after any `src/` change.
- [x] `npm run itch:preview` green — the `download` channel is still empty, so all three entries
      are new.
- [x] `npm run itch:cover` green — 630×500 and 960×400, checked from the PNG headers.
- [ ] Page created, and **Kind of Game is `Downloadable`**.
- [ ] Description, tags, screenshots and both plates are on the page.
- [ ] Price is free, and `tarlow@mossaistudio.com` is visible on the page.
- [ ] `npm run itch:publish`, then download the ZIP from the page, unzip it, double-click
      `lotus-dashboard.html`, move a widget, press Ctrl+S, reopen it, and check the change came
      back. This one needs a person, and it is the last thing between the build and a visitor.
