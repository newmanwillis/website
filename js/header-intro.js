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
// Runs once per full page load, homepage only. Skipped entirely for
// prefers-reduced-motion. Any failure or slow font load falls back to
// simply showing the header (safety timeout below).
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

  var header = document.querySelector('.intro-cover header');
  if (!header) return;                                   // homepage only
  if (document.querySelector('.page-content')) return;   // not project pages
  var h1 = header.querySelector('h1');
  if (!h1) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var els = [h1].concat(LINES.map(function (l) { return header.querySelector(l.sel); }));
  if (els.some(function (e) { return !e; })) return;

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
      el.classList.remove('intro-anim-hidden');
      el.style.clipPath = '';
    });
  }

  // hide immediately (script runs before first paint at end of body)
  els.forEach(function (el) { el.classList.add('intro-anim-hidden'); });
  // absolute safety net: whatever happens, the header is visible
  setTimeout(revealAll, SAFETY_MS);

  function makeCanvas(L, T, W, H) {
    var dpr = window.devicePixelRatio || 1;
    var c = document.createElement('canvas');
    c.className = 'header-intro-canvas';
    c.width = W * dpr; c.height = H * dpr;
    c.style.width = W + 'px'; c.style.height = H + 'px';
    c.style.left = L + 'px'; c.style.top = T + 'px';
    document.body.appendChild(c);
    c.getContext('2d').scale(dpr, dpr);
    canvases.push(c);
    return c;
  }

  // Draw an element's text into an offscreen context using the same
  // baseline math the browser uses (half-leading + font ascent), so the
  // sampled cells land exactly on the rendered glyphs.
  function drawTextUnit(o, el, x, y, wdt, hgt) {
    var cs = getComputedStyle(el);
    o.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    if ('letterSpacing' in o) o.letterSpacing = cs.letterSpacing;
    o.textAlign = 'center';
    o.textBaseline = 'alphabetic';
    var text = el.textContent.trim().replace(/\s+/g, ' ');
    var m = o.measureText(text);
    var fasc = m.fontBoundingBoxAscent || parseFloat(cs.fontSize) * 0.8;
    var fdesc = m.fontBoundingBoxDescent || parseFloat(cs.fontSize) * 0.2;
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

  function offscreen(W, H) {
    var dpr = window.devicePixelRatio || 1;
    var off = document.createElement('canvas');
    off.width = W * dpr; off.height = H * dpr;
    var o = off.getContext('2d');
    o.scale(dpr, dpr);
    o.fillStyle = INK;
    return o;
  }

  function sampleCellsFrom(o, W, H, threshold) {
    var dpr = window.devicePixelRatio || 1;
    var img = o.getImageData(0, 0, W * dpr, H * dpr).data;
    var cells = [];
    for (var cy = 0; cy < H / CELL; cy++) {
      for (var cx = 0; cx < W / CELL; cx++) {
        var acc = 0, n = 0;
        for (var sy = 1; sy < CELL; sy += 2) {
          for (var sx = 1; sx < CELL; sx += 2) {
            var px = ((cx * CELL + sx) * dpr) | 0, py = ((cy * CELL + sy) * dpr) | 0;
            acc += img[(py * W * dpr + px) * 4 + 3]; n++;
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
    if (r.width < 4) return null;
    var g = gridBox(r);
    var o = offscreen(g.W, g.H);
    var sx = window.scrollX, sy = window.scrollY;
    units.forEach(function (u) {
      var ur = u.el.getBoundingClientRect();
      if (ur.width <= 0) return;
      var x = ur.left + sx - g.L, y = ur.top + sy - g.T;
      if (u.kind === 'box') o.fillRect(x, y, ur.width, ur.height);
      else drawTextUnit(o, u.el, x, y, ur.width, ur.height);
    });
    var cells = sampleCellsFrom(o, g.W, g.H, 0.08);
    return { L: g.L, T: g.T, W: g.W, H: g.H, cells: cells,
             elLeft: r.left + sx, elW: r.width };
  }

  function trailReveal(el, delay, dur) {
    later(function () {
      if (finished) return;
      var s = sampleLine(el);
      el.style.clipPath = 'inset(0 100% 0 0)';
      el.classList.remove('intro-anim-hidden');
      if (!s || !s.cells.length) { el.style.clipPath = ''; return; }
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
    if (r.width < 10) return null;
    var g = gridBox(r);
    var o = offscreen(g.W, g.H);
    var sx = window.scrollX, sy = window.scrollY;
    drawTextUnit(o, h1, (r.left + sx) - g.L, (r.top + sy) - g.T, r.width, r.height);
    var dpr = window.devicePixelRatio || 1;
    var img = o.getImageData(0, 0, g.W * dpr, g.H * dpr).data;
    var c2x = g.W / 2, c2y = g.H / 2;
    var a2 = new Float32Array(c2x * c2y);
    for (var y2 = 0; y2 < c2y; y2++) {
      for (var x2 = 0; x2 < c2x; x2++) {
        var px = ((x2 * 2 + 1) * dpr) | 0, py = ((y2 * 2 + 1) * dpr) | 0;
        a2[y2 * c2x + x2] = img[(py * g.W * dpr + px) * 4 + 3] / 255;
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
    return { L: g.L, T: g.T, W: g.W, H: g.H,
             lv8: aggregate(4), lv6: aggregate(3), lv4: aggregate(2), lv2: aggregate(1) };
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
      var s = sampleName();
      if (!s || !s.lv8.length) { h1.classList.remove('intro-anim-hidden'); return; }
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
    try {
      LINES.forEach(function (l) {
        trailReveal(header.querySelector(l.sel), l.delay, l.dur);
      });
      nameRun(NAME_START);
    } catch (e) {
      revealAll();
    }
  }

  // start once fonts have settled (capped wait — never block the header)
  var started = false;
  function go() { if (!started && !finished) { started = true; play(); } }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(go);
    document.fonts.load('600 1em Teko').then(go).catch(function () {});
    setTimeout(go, 900);
  } else {
    setTimeout(go, 150);
  }
})();
