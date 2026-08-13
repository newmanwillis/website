// header-intro.js — homepage header entrance animation.
//
// The name materializes in place on the background's 8px pixel grid:
// cells trickle in top-to-bottom, hold briefly, then resolve through a
// resolution ladder (8px -> 6px -> 4px -> 2px -> crisp text).
// The eyebrow / bio / contact lines are led in left-to-right by a trailing
// pixel front: cells darken in from the background's ambient tone, dwell as
// readable pixels, then crossfade column-by-column into the real text.
// All four lines run as an overlapping top-down cascade (~1.4s total).
//
// Robustness:
//  - The header is hidden by CSS before first paint via the inline
//    `header-intro-pending` bootstrap in index.html's <head>, so there is
//    no flash of un-animated text on a cold load. This script takes over
//    that hiding synchronously.
//  - The pixel effect needs canvas pixel readback (getImageData). Firefox
//    with resistFingerprinting / canvas-extraction blocking returns blank
//    data, and other environments can fail in similar ways. We probe for
//    this up front and validate every sample; if the pixel path is not
//    usable we run a grid-flavoured stepped wipe instead, so the entrance
//    still looks designed rather than popping in.
//  - Skipped entirely for prefers-reduced-motion; a hard safety timeout
//    reveals the header no matter what goes wrong.
(function () {
  'use strict';

  var CELL = 8;
  var INK = '#0f0e0c';
  // background ambient pixel tone (matches animation.js BASE_R/G/B)
  var BG_R = 58, BG_G = 56, BG_B = 48;
  var INK_R = 15, INK_G = 14, INK_B = 12;

  // ── timing (the "Current" spec) ──
  var SWEEP = 420, JITTER = 130, RAMP = 150;              // name trickle
  var HOLD8 = 20, STEP6 = 80, STEP4 = 80, STEP2 = 70;     // resolve ladder
  var FADE = 180;                                         // final crossfade
  var RAMP_IN = 230, RAMP_OUT = 90, JIT = 35, DWELL = 250; // line trails
  var NAME_START = 110;
  var LINES = [
    { sel: '.header-role', delay: 0, dur: 380 },
    { sel: '.header-bio', delay: 300, dur: 420 },
    { sel: '.header-contact', delay: 470, dur: 460 }
  ];
  var SAFETY_MS = 3600;
  var MIN_CELLS = 4;      // fewer than this means the sample is unusable
  var FONT_WAIT_MS = 1200; // cap on waiting for webfonts before starting

  var htmlEl = document.documentElement;
  function clearPending() { htmlEl.classList.remove('header-intro-pending'); }

  var header = document.querySelector('.intro-cover header');
  if (!header || document.querySelector('.page-content')) { clearPending(); return; }
  var h1 = header.querySelector('h1');
  if (!h1) { clearPending(); return; }

  var lineEls = LINES.map(function (l) { return header.querySelector(l.sel); });
  if (lineEls.some(function (e) { return !e; })) { clearPending(); return; }
  var els = [h1].concat(lineEls);

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { clearPending(); return; }

  // Take over the pre-paint hiding synchronously: add our own hidden class
  // first, then release the bootstrap class, so nothing is ever visible
  // in between.
  els.forEach(function (el) { el.classList.add('intro-anim-hidden'); });
  clearPending();

  var timeouts = [], rafs = [], canvases = [], finished = false;
  function later(fn, ms) { timeouts.push(setTimeout(fn, ms)); }
  function raf(fn) { rafs.push(requestAnimationFrame(fn)); }
  function revealAll() {
    if (finished) return;
    finished = true;
    rafs.forEach(cancelAnimationFrame);
    timeouts.forEach(clearTimeout);
    canvases.forEach(function (c) { c.remove(); });
    els.forEach(function (el) {
      el.classList.remove('intro-anim-hidden', 'header-intro-wipe-x', 'header-intro-wipe-y');
      el.style.clipPath = '';
      el.style.animationDelay = '';
    });
  }
  setTimeout(revealAll, SAFETY_MS);

  // Device pixel ratio, capped and used via exact integer backing sizes so
  // fractional ratios (Windows display scaling) can never desync the
  // row stride we index with below.
  var DPR = Math.min(2, Math.max(1, window.devicePixelRatio || 1));

  // ── canvas capability probe ──────────────────────────────────────────
  // Returns false when pixel readback is blocked or lies (Firefox
  // resistFingerprinting, hardened privacy modes, some embedded webviews).
  function canvasReadbackWorks() {
    try {
      var c = document.createElement('canvas');
      c.width = 8; c.height = 8;
      var x = c.getContext('2d');
      if (!x) return false;
      x.fillStyle = '#000';
      x.fillRect(0, 0, 8, 8);
      var d = x.getImageData(0, 0, 8, 8).data;
      var solid = 0;
      for (var i = 3; i < d.length; i += 4) if (d[i] > 200) solid++;
      return solid > 32; // expect all 64 opaque; allow noise-injection slack
    } catch (e) {
      return false;
    }
  }

  // ── graceful fallback: grid-flavoured stepped wipe (no canvas) ────────
  function wipeIn(el, delay, vertical) {
    el.style.animationDelay = delay + 'ms';
    el.classList.remove('intro-anim-hidden');
    el.classList.add(vertical ? 'header-intro-wipe-y' : 'header-intro-wipe-x');
    var done = function () {
      el.classList.remove('header-intro-wipe-x', 'header-intro-wipe-y');
      el.style.animationDelay = '';
      el.style.clipPath = '';
      el.removeEventListener('animationend', done);
    };
    el.addEventListener('animationend', done);
    later(done, delay + 900); // belt and braces if animationend never fires
  }
  function runFallback() {
    wipeIn(lineEls[0], LINES[0].delay, false);
    wipeIn(h1, NAME_START, true);
    wipeIn(lineEls[1], LINES[1].delay, false);
    wipeIn(lineEls[2], LINES[2].delay, false);
  }

  function makeCanvas(L, T, W, H) {
    var c = document.createElement('canvas');
    c.className = 'header-intro-canvas';
    c.width = Math.max(1, Math.round(W * DPR));
    c.height = Math.max(1, Math.round(H * DPR));
    c.style.width = W + 'px'; c.style.height = H + 'px';
    c.style.left = L + 'px'; c.style.top = T + 'px';
    document.body.appendChild(c);
    var ctx = c.getContext('2d');
    ctx.setTransform(c.width / W, 0, 0, c.height / H, 0, 0);
    canvases.push(c);
    return c;
  }

  // Draw an element's text into an offscreen context using the same
  // baseline math the browser uses (half-leading + font ascent), so the
  // sampled cells land exactly on the rendered glyphs.
  function drawTextUnit(o, el, x, y, wdt, hgt) {
    var cs = getComputedStyle(el);
    var size = cs.fontSize;
    var spec = cs.fontStyle + ' ' + cs.fontWeight + ' ' + size + ' ' + cs.fontFamily;
    o.font = spec;
    // If the browser rejected the shorthand, ctx.font keeps its previous
    // value — fall back to a minimal, always-valid form.
    if (o.font.indexOf(parseInt(size, 10)) === -1) o.font = size + ' ' + cs.fontFamily;
    if ('letterSpacing' in o) {
      try { o.letterSpacing = cs.letterSpacing; } catch (e) {}
    }
    o.textAlign = 'center';
    o.textBaseline = 'alphabetic';
    var text = el.textContent.trim().replace(/\s+/g, ' ');
    var m = o.measureText(text);
    var fasc = m.fontBoundingBoxAscent || m.actualBoundingBoxAscent || parseFloat(size) * 0.8;
    var fdesc = m.fontBoundingBoxDescent || m.actualBoundingBoxDescent || parseFloat(size) * 0.2;
    o.fillText(text, x + wdt / 2, y + (hgt - (fasc + fdesc)) / 2 + fasc);
  }

  function gridBox(r) {
    var sx = window.scrollX, sy = window.scrollY;
    var L = Math.floor((r.left + sx) / CELL) * CELL;
    var T = Math.floor((r.top + sy) / CELL) * CELL;
    return { L: L, T: T,
             W: Math.ceil((r.right + sx) / CELL) * CELL - L,
             H: Math.ceil((r.bottom + sy) / CELL) * CELL - T };
  }

  // Offscreen surface with integer backing size; sx/sy are the exact
  // device-pixels-per-CSS-pixel factors actually in effect.
  function offscreen(W, H) {
    var off = document.createElement('canvas');
    var pw = Math.max(1, Math.round(W * DPR)), ph = Math.max(1, Math.round(H * DPR));
    off.width = pw; off.height = ph;
    var o = off.getContext('2d');
    o.setTransform(pw / W, 0, 0, ph / H, 0, 0);
    o.fillStyle = INK;
    return { o: o, pw: pw, ph: ph, kx: pw / W, ky: ph / H };
  }

  function sampleCellsFrom(s, W, H, threshold) {
    var img;
    try {
      img = s.o.getImageData(0, 0, s.pw, s.ph).data;
    } catch (e) {
      return null;
    }
    var cells = [];
    for (var cy = 0; cy < H / CELL; cy++) {
      for (var cx = 0; cx < W / CELL; cx++) {
        var acc = 0, n = 0;
        for (var sy = 1; sy < CELL; sy += 2) {
          for (var sx = 1; sx < CELL; sx += 2) {
            var px = Math.min(s.pw - 1, ((cx * CELL + sx) * s.kx) | 0);
            var py = Math.min(s.ph - 1, ((cy * CELL + sy) * s.ky) | 0);
            acc += img[(py * s.pw + px) * 4 + 3]; n++;
          }
        }
        var a = acc / n / 255;
        if (a > threshold) cells.push({ x: cx * CELL, y: cy * CELL, a: Math.min(1, a * 1.3) });
      }
    }
    return cells;
  }

  // ── supporting lines: trailing pixel front, dwell, column crossfade ──
  function sampleLine(el) {
    var isContact = el.classList.contains('header-contact');
    var units = [];
    if (isContact) {
      el.querySelectorAll('a').forEach(function (a) { units.push({ kind: 'text', el: a }); });
      el.querySelectorAll('.contact-divider').forEach(function (d) { units.push({ kind: 'box', el: d }); });
    } else {
      units.push({ kind: 'text', el: el });
    }
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return null;
    var g = gridBox(r);
    var s = offscreen(g.W, g.H);
    var sx = window.scrollX, sy = window.scrollY;
    units.forEach(function (u) {
      var ur = u.el.getBoundingClientRect();
      if (ur.width <= 0) return;
      var x = ur.left + sx - g.L, y = ur.top + sy - g.T;
      if (u.kind === 'box') s.o.fillRect(x, y, ur.width, ur.height);
      else drawTextUnit(s.o, u.el, x, y, ur.width, ur.height);
    });
    var cells = sampleCellsFrom(s, g.W, g.H, 0.08);
    if (!cells || cells.length < MIN_CELLS) return null;
    return { L: g.L, T: g.T, W: g.W, H: g.H, cells: cells,
             elLeft: r.left + sx, elW: r.width };
  }

  function trailReveal(el, delay, dur) {
    later(function () {
      if (finished) return;
      var s = null;
      try { s = sampleLine(el); } catch (e) { s = null; }
      if (!s) { wipeIn(el, 0, false); return; } // graceful, still designed
      el.style.clipPath = 'inset(0 100% 0 0)';
      el.classList.remove('intro-anim-hidden');
      var canvas = makeCanvas(s.L, s.T, s.W, s.H);
      var ctx = canvas.getContext('2d');
      var span = s.W + CELL;
      s.cells.forEach(function (c) {
        c.tIn = (c.x / span) * dur + (Math.random() * 2 - 1) * JIT;
      });
      var total = dur + RAMP_IN + DWELL + RAMP_OUT + 100;
      var t0 = performance.now();
      function frame(now) {
        if (finished) return;
        var t = now - t0;
        // crisp text is revealed DWELL+RAMP_IN ms behind the pixel front
        var frontReveal = ((t - DWELL - RAMP_IN) / dur) * span;
        var reveal = Math.max(0, Math.min(s.W, Math.floor(frontReveal / CELL) * CELL));
        var revealEl = Math.max(0, Math.min(s.elW, reveal - (s.elLeft - s.L)));
        el.style.clipPath = 'inset(0 ' + Math.max(0, Math.round(s.elW - revealEl)) + 'px 0 0)';
        ctx.clearRect(0, 0, s.W, s.H);
        for (var i = 0; i < s.cells.length; i++) {
          var c = s.cells[i];
          var p = (t - c.tIn) / RAMP_IN;
          if (p <= 0) continue;
          if (p > 1) p = 1;
          var tOut = c.tIn + RAMP_IN + DWELL;
          var aOut = 1 - (t - tOut) / RAMP_OUT;
          if (aOut <= 0) continue;
          if (aOut > 1) aOut = 1;
          // darken in from the background's ambient pixel tone
          var e = p * p;
          var amb = Math.min(0.11, p * 0.9);
          var alpha = amb + Math.max(0, c.a - 0.11) * e;
          var R = Math.round(BG_R + (INK_R - BG_R) * e);
          var G = Math.round(BG_G + (INK_G - BG_G) * e);
          var B = Math.round(BG_B + (INK_B - BG_B) * e);
          ctx.fillStyle = 'rgb(' + R + ',' + G + ',' + B + ')';
          ctx.globalAlpha = alpha * aOut;
          ctx.fillRect(c.x, c.y, CELL - 1, CELL - 1);
        }
        ctx.globalAlpha = 1;
        if (t >= total) {
          el.style.clipPath = '';
          canvas.style.opacity = '0';
          later(function () { canvas.remove(); }, 200);
          return;
        }
        raf(frame);
      }
      raf(frame);
    }, delay);
  }

  // ── name: 2px base sample aggregated to 8/6/4/2px levels ──
  function sampleName() {
    var r = h1.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return null;
    var g = gridBox(r);
    var s = offscreen(g.W, g.H);
    var sx = window.scrollX, sy = window.scrollY;
    drawTextUnit(s.o, h1, (r.left + sx) - g.L, (r.top + sy) - g.T, r.width, r.height);
    var img;
    try {
      img = s.o.getImageData(0, 0, s.pw, s.ph).data;
    } catch (e) {
      return null;
    }
    var c2x = g.W / 2, c2y = g.H / 2;
    var a2 = new Float32Array(c2x * c2y);
    for (var y2 = 0; y2 < c2y; y2++) {
      for (var x2 = 0; x2 < c2x; x2++) {
        var px = Math.min(s.pw - 1, ((x2 * 2 + 1) * s.kx) | 0);
        var py = Math.min(s.ph - 1, ((y2 * 2 + 1) * s.ky) | 0);
        a2[y2 * c2x + x2] = img[(py * s.pw + px) * 4 + 3] / 255;
      }
    }
    function aggregate(f) { // f = subcells (2px units) per side
      var nx = Math.ceil(c2x / f), ny = Math.ceil(c2y / f);
      var out = [];
      for (var gy = 0; gy < ny; gy++) {
        for (var gx = 0; gx < nx; gx++) {
          var acc = 0, n = 0;
          for (var yy = 0; yy < f; yy++) {
            for (var xx = 0; xx < f; xx++) {
              var X = gx * f + xx, Y = gy * f + yy;
              if (X >= c2x || Y >= c2y) continue;
              acc += a2[Y * c2x + X]; n++;
            }
          }
          var a = n ? acc / n : 0;
          if (a > 0.07) out.push({ x: gx * f * 2, y: gy * f * 2, a: Math.min(1, a * 1.3) });
        }
      }
      return out;
    }
    var lv8 = aggregate(4);
    if (lv8.length < MIN_CELLS) return null;
    return { L: g.L, T: g.T, W: g.W, H: g.H,
             lv8: lv8, lv6: aggregate(3), lv4: aggregate(2), lv2: aggregate(1) };
  }

  function drawLevel(ctx, s, cells, size) {
    ctx.clearRect(0, 0, s.W, s.H);
    ctx.fillStyle = INK;
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      ctx.globalAlpha = c.a;
      ctx.fillRect(c.x, c.y, size, size);
    }
    ctx.globalAlpha = 1;
  }

  function nameRun(delay) {
    later(function () {
      if (finished) return;
      var s = null;
      try { s = sampleName(); } catch (e) { s = null; }
      if (!s) { wipeIn(h1, 0, true); return; }
      var canvas = makeCanvas(s.L, s.T, s.W, s.H);
      var ctx = canvas.getContext('2d');
      s.lv8.forEach(function (c) {
        c.t0 = (c.y / Math.max(1, s.H - CELL)) * SWEEP + Math.random() * JITTER;
      });
      var buildTotal = SWEEP + JITTER + RAMP;
      var t0 = performance.now();
      function frame(now) {
        if (finished) return;
        var el = now - t0;
        ctx.clearRect(0, 0, s.W, s.H);
        ctx.fillStyle = INK;
        for (var i = 0; i < s.lv8.length; i++) {
          var c = s.lv8[i];
          var p = (el - c.t0) / RAMP;
          if (p <= 0) continue;
          if (p > 1) p = 1;
          ctx.globalAlpha = c.a * p;
          ctx.fillRect(c.x, c.y, CELL - 1, CELL - 1);
        }
        ctx.globalAlpha = 1;
        if (el >= buildTotal) {
          later(function () { drawLevel(ctx, s, s.lv6, 6); }, HOLD8);
          later(function () { drawLevel(ctx, s, s.lv4, 4); }, HOLD8 + STEP6);
          later(function () { drawLevel(ctx, s, s.lv2, 2); }, HOLD8 + STEP6 + STEP4);
          later(function () {
            h1.classList.remove('intro-anim-hidden');
            canvas.style.opacity = '0';
            later(function () { canvas.remove(); }, FADE + 60);
          }, HOLD8 + STEP6 + STEP4 + STEP2);
          return;
        }
        raf(frame);
      }
      raf(frame);
    }, delay);
  }

  function play() {
    if (!canvasReadbackWorks()) { runFallback(); return; }
    try {
      LINES.forEach(function (l, i) { trailReveal(lineEls[i], l.delay, l.dur); });
      nameRun(NAME_START);
    } catch (e) {
      runFallback();
    }
  }

  // ── start once webfonts have actually settled ────────────────────────
  // document.fonts.ready can resolve before the stylesheet's @font-face
  // rules are known (the font CSS is a separate request), so we verify
  // with fonts.check() and poll briefly rather than trusting it alone.
  var started = false;
  function go() { if (!started && !finished) { started = true; play(); } }

  function fontsSettled() {
    try {
      return document.fonts.check('600 1em Teko') &&
             document.fonts.check('700 1em Inter');
    } catch (e) {
      return true; // can't tell — don't block the animation
    }
  }

  if (document.fonts && document.fonts.ready) {
    var t0 = performance.now();
    (function pollFonts() {
      if (started || finished) return;
      if (fontsSettled() || performance.now() - t0 > FONT_WAIT_MS) { go(); return; }
      setTimeout(pollFonts, 50);
    })();
    document.fonts.ready.then(function () {
      // give layout one frame to reflow with the real metrics
      requestAnimationFrame(function () { requestAnimationFrame(go); });
    });
  } else {
    setTimeout(go, 150);
  }
})();
