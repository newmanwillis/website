# newmanwillis.com

Static portfolio site — plain HTML/CSS/JS, no build step, no dependencies.
Deployed straight from `main` to GitHub Pages, served at newmanwillis.com via `CNAME`.

## Working agreement

- **Never commit and never push.** Write changes into the working tree and stop.
  Newman reviews the diff in VS Code and pushes himself.
- **One requested change at a time.** Don't bundle unrelated fixes, don't "improve"
  things that weren't asked about, and don't touch other files because they look
  wrong. If something else is broken, say so and leave it alone.
- **Preview before shipping.** Build a preview file, get approval, then write to the
  working tree. Exception: a straight revert of something that's already broken.
- Wait for the current change to be committed before starting the next one.

## Layout

```
index.html              the whole main page
main.css                global styles
projects/*.html         9 project pages
projects/project-page.css   project page styles — ALSO linked from index.html
js/router.js            SPA router: fetch -> DOMParser -> swap #site-content.innerHTML
js/animation.js         background pixel rain (the canvas behind everything)
js/header-intro.js      the name/tagline pixel intro, main page only
js/page-transition.js   the centre cover shown during home <-> project navigation
js/nav.js               the projects dropdown
```

## Things that have actually broken

**The router means index.html's `<head>` is the one that applies.**
`router.js` swaps a project page's *markup* into `index.html` — the project page's own
`<head>` never runs on a routed navigation. So anything a project page needs (fonts
especially) must be requested by `index.html`, not just by the project page.
Trimming index.html's font request once silently killed Archivo/Sora/Syne on every
project page reached by clicking, while direct URL loads still looked fine.
`index.html` deliberately carries **two** font `<link>`s — keep them separate; folding
them into one is what broke Teko in Chrome.

**Line endings are per-file and mixed.** A patch written with `\n` silently fails to
match a CRLF file. Check the file first and match it.

| ending | files |
|---|---|
| CRLF | `js/animation.js`, `js/nav.js`, `js/neon-glitch.js`, `js/page-transition.js`, most `projects/*.html` |
| LF | `main.css`, `js/router.js`, `js/header-intro.js` |
| mixed | `index.html` (one stray CRLF), `projects/project-page.css` |

**Canvases size from their own box, never `documentElement.clientWidth`.**
`#bg-canvas` is `position:fixed; width:100%`, and on mobile the initial containing
block *widens* when anything overflows sideways — so its CSS box can be wider than
`clientWidth`. Sizing the backing store from `clientWidth` stretches the whole 8px
grid across the bigger box. Same class of bug as the desktop scrollbar one:
`window.innerWidth` includes a classic scrollbar, `clientWidth` and `%` widths don't.

**GitHub Pages is case-sensitive.** `.jpg` vs `.JPG` in a `src` 404s on the live site
while working locally on Windows.

**`file://` breaks the router.** `fetch()` is CORS-blocked, so the router falls back to
full page loads and transitions look broken. Always test over `http://`, never by
double-clicking the file.

## The 8px grid

`animation.js` draws on `CELL = 8`, cells painted at `CELL - 1` (7px) leaving a 1px gap,
base colour `rgb(58,56,48)`, leading-edge darkness `0.14`, ambient `0.03`–`0.12`.
Anything that draws pixels — the page-transition cover, the header intro — snaps to that
same grid so the gaps line up. If two grids disagree the seam is instantly visible.

`page-transition.js` and `animation.js` must agree *exactly* on the centre panel edges
or the hand-off pops when the stand-in is removed.

## Testing

- Serve over HTTP and drive with Playwright (headless Chromium) rather than eyeballing.
- Headless Chromium here has **overlay scrollbars only** — a classic space-taking
  scrollbar has to be simulated by patching `Element.prototype.clientWidth` for
  `documentElement` plus CSS on `#bg-canvas` / `#pt-cover` / `body`.
- The background is random per load, so screenshot diffs need either a seeded
  `Math.random` or `#bg-canvas` hidden — otherwise ~6% of pixels differ every run and
  the diff is meaningless.
- Real font metrics matter for layout checks. The sandbox can't reach
  fonts.googleapis.com; install the faces from npm (`@fontsource/dm-sans`, `teko`,
  `figtree`, `inter`) and inject `@font-face` rules pointing at local files.
