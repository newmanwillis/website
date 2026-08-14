// page-transition.js — the project pages' centre cover panel, used as the
// transition between the grid and a project.
//
// The panel is normally .page-content::before, whose edges animation.js snaps
// to the 8px column grid and feathers with four stepped columns. During a
// navigation the real panel is inside the content being swapped, so this module
// paints a stand-in with identical geometry underneath the content layer,
// animates it, and hands back once the real one is in place.
//
// The stand-in is a canvas drawn on the same 8px grid as the background rain,
// so the panel assembles out of pixels. Each cell has a fixed arrival time; the
// style decides how those times are distributed, which is the whole difference
// between the variants. A cell arrives as a background-toned square, lightens
// to the panel colour over a few frames, then closes the 1px gap the rain uses
// and becomes part of the solid field.
window.PageTransition = (function () {
  'use strict';

  var CELL = 8;
  var FEATHER = [0.8, 0.6, 0.4, 0.2];   // columns outside the panel, inner -> outer

  var LINE_FADE = 130;

  // Per style: how long the sweep runs, and how long a cell holds the rain's
  // 1px gap before closing up (as a fraction of the sweep). The gap phase is
  // what gives a front its trail, so the streaming style holds it much longer.
  var CFG = {
    outward:  { expand: 620, retract: 520, life: 0.10 },
    rows:     { expand: 980, retract: 800, life: 0.22 },
    dissolve: { expand: 620, retract: 520, life: 0.10 },
    solid:    { expand: 620, retract: 520, life: 0.10 }
  };
  function cfg() { return CFG[style] || CFG.outward; }

  // 'rows': the spread of row speeds, how far apart rows start, and how much
  // neighbouring cells in a row differ -- all relative to the time a mid-speed
  // row takes to cross.
  var ROW_SLOW = 0.45, ROW_FAST = 1.7;
  var ROW_START = 0.35;
  var CELL_JITTER = 0.06;

  // 'outward': every row advances together, with just enough per-cell jitter
  // that the edge is made of pixels rather than being a straight line.
  var EDGE_JITTER = 0.10;

  // Cells are the panel's own colour -- they are the panel arriving, not
  // background pixels. What makes an arriving cell legible is the 1px gap it
  // carries: the rain shows through between cells until they close up.
  var SOLID = 'rgb(245, 244, 240)';

  // Which fill the cover uses. To go back to the original behaviour -- a solid
  // rectangle stretching out from the centre line, with no pixels -- change
  // this one word to 'solid'. The other two are alternatives that were tried:
  // 'outward' is a single pixel front expanding from the centre, 'rows' is the
  // streaming variant where each row runs outward at its own speed.
  //
  //   'dissolve' | 'solid' | 'outward' | 'rows'
  var style = 'dissolve';

  // A heavily front-loaded curve reads as a snap; this eases in and out.
  var ease = bezier(0.45, 0.05, 0.2, 1);

  var el = null, ctx = null;
  var dpr = 1, cw = 0, ch = 0;
  var cellsKey = '', span = 1, cellD = null, LIFE = 0.10;
  var settledAt = 0, arrivedAt = 0, drawnPP = -1;

  function viewW() { return document.documentElement.clientWidth || window.innerWidth; }
  function viewH() { return document.documentElement.clientHeight || window.innerHeight; }

  // Raised while the stand-in is on screen. animation.js checks this and stops
  // drawing its own edge feathering, so exactly one layer exists at any moment.
  function own(v) { window.__ptCover = !!v; }

  // Stable per-cell noise. Has to be a pure function of the cell, not random per
  // frame, or the pattern would boil instead of settling.
  function noise(i) {
    var x = Math.sin(i * 12.9898 + 4.1414) * 43758.5453;
    return x - Math.floor(x);
  }

  function bezier(x1, y1, x2, y2) {
    function A(a, b) { return 1 - 3 * b + 3 * a; }
    function B(a, b) { return 3 * b - 6 * a; }
    function C(a) { return 3 * a; }
    function calc(t, a, b) { return ((A(a, b) * t + B(a, b)) * t + C(a)) * t; }
    function slope(t, a, b) { return 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a); }
    return function (x) {
      var t = x;
      for (var i = 0; i < 6; i++) {
        var s = slope(t, x1, x2);
        if (Math.abs(s) < 1e-6) break;
        t -= (calc(t, x1, x2) - x) / s;
      }
      return calc(t, y1, y2);
    };
  }

  function build() {
    if (el && el.isConnected) { size(); return el; }
    el = document.createElement('canvas');
    el.id = 'pt-cover';
    document.body.appendChild(el);
    ctx = el.getContext('2d');
    cw = ch = 0;
    size();
    return el;
  }

  // Same discipline as animation.js: an integer backing store measured from the
  // client box, transform derived from it, so one canvas pixel is one CSS pixel
  // whatever the device pixel ratio or scrollbar state.
  function size() {
    var w = viewW(), h = viewH(), d = window.devicePixelRatio || 1;
    if (w === cw && h === ch && d === dpr && el.width) return;
    cw = w; ch = h; dpr = d;
    el.width = Math.round(w * d);
    el.height = Math.round(h * d);
    ctx.setTransform(el.width / w, 0, 0, el.height / h, 0, 0);
    cellsKey = '';
  }

  // Where the real panel's edges are, snapped to the grid animation.js uses.
  function edges() {
    var l, r;
    var pc = document.querySelector('.page-content');
    if (pc) {
      var rect = pc.getBoundingClientRect();
      l = rect.left; r = rect.right;
    } else {
      // The project page isn't in the DOM yet, so reproduce its CSS. --max is
      // `clamp(1020px, 68vw, 1200px)`: vw units include a classic scrollbar,
      // but the element is centred in the client box, which excludes it.
      var iw = window.innerWidth;
      var cwid = document.documentElement.clientWidth || iw;
      var maxW = Math.min(cwid, Math.min(1200, Math.max(1020, iw * 0.68)));
      l = (cwid - maxW) / 2; r = l + maxW;
    }
    return { l: Math.floor(l / CELL) * CELL, r: Math.ceil(r / CELL) * CELL };
  }

  // One entry per cell, sorted by arrival time. Sorting once means a frame only
  // has to touch the cells currently in flight -- everything already settled
  // lives in an offscreen buffer that gets blitted, so the per-frame cost is
  // proportional to the width of the leading edge and not to the panel area.
  // One entry per cell, ordered by arrival time. Ordering once means a frame
  // only has to touch the cells currently in flight -- everything already
  // settled lives in an offscreen buffer that gets blitted, so the per-frame
  // cost tracks the width of the leading edge, not the area of the panel.
  //
  // Built with typed arrays and a counting sort rather than Array#sort: this
  // runs on the first frame of a navigation, and a comparator sort over ~16k
  // objects is long enough to show up as a hitch right as the panel starts.
  var cx0 = 0, cx1 = 0;                       // region the cover ever paints
  var cellX, cellY, cellM, order, cellN;
  function ensureCells() {
    var e = edges();
    var key = style + '|' + e.l + '|' + e.r + '|' + cw + '|' + ch;
    if (key === cellsKey) return e;
    cellsKey = key;

    var pad = FEATHER.length * CELL;
    cx0 = e.l - pad; cx1 = e.r + pad;
    var mid = (e.l + e.r) / 2, half = (cx1 - cx0) / 2 || 1;
    var rows = Math.ceil(ch / CELL) + 1;
    var cols = Math.round((cx1 - cx0) / CELL);
    var n = rows * cols;

    // Each row gets its own outward speed AND its own start time. Speed alone
    // is not enough: every row's innermost cell sits at the same distance from
    // the centre, so they all arrive on the same frame and the centre column
    // appears as one solid bar before anything extends outward. Staggering the
    // starts means rows begin one at a time and the centre line assembles cell
    // by cell like the rest of the panel.
    var speed = new Float32Array(rows), start = new Float32Array(rows);
    for (var r = 0; r < rows; r++) {
      speed[r] = ROW_SLOW + noise(r * 7919 + 13) * (ROW_FAST - ROW_SLOW);
      start[r] = noise(r * 4177 + 29) * ROW_START;
    }

    var xs = new Int16Array(n), ys = new Int16Array(n);
    var ms = new Float32Array(n), ds = new Float32Array(n);
    var i = 0, maxD = 0;
    for (var c = 0; c < cols; c++) {
      var x = cx0 + c * CELL;
      var norm = Math.abs(x + CELL / 2 - mid) / half;
      var m = 1;
      if (x < e.l) m = FEATHER[Math.min(3, Math.floor((e.l - x - 1) / CELL))];
      else if (x >= e.r) m = FEATHER[Math.min(3, Math.floor((x - e.r) / CELL))];
      for (var rr = 0; rr < rows; rr++, i++) {
        var d;
        if (style === 'dissolve') {
          d = noise(c * 977 + rr * 31 + 7);     // anywhere in the panel, any time
        } else if (style === 'rows') {
          d = start[rr] + norm / speed[rr] + noise(c * 613 + rr) * CELL_JITTER;
        } else {
          d = norm + noise(c * 613 + rr) * EDGE_JITTER;   // one front, pixel edge
        }
        xs[i] = x; ys[i] = rr * CELL; ms[i] = m; ds[i] = d;
        if (d > maxD) maxD = d;
      }
    }
    if (maxD > 0) for (i = 0; i < n; i++) ds[i] /= maxD;   // normalise to 0..1

    // Counting sort into 512 buckets. Cells inside one bucket are effectively
    // simultaneous (1/512 of the sweep is well under a frame), so their order
    // within it does not matter.
    var NB = 512;
    var count = new Int32Array(NB + 1);
    for (i = 0; i < n; i++) count[Math.min(NB - 1, (ds[i] * NB) | 0)]++;
    var acc = 0;
    for (var b = 0; b < NB; b++) { var v = count[b]; count[b] = acc; acc += v; }
    var ord = new Int32Array(n);
    for (i = 0; i < n; i++) ord[count[Math.min(NB - 1, (ds[i] * NB) | 0)]++] = i;

    cellX = xs; cellY = ys; cellM = ms; cellD = ds; order = ord; cellN = n;
    LIFE = cfg().life;
    span = 1 + LIFE;
    settledAt = arrivedAt = 0;
    drawnPP = -1;
    return e;
  }

  // The settled panel, drawn as plain rectangles. This is the state the cover
  // spends most of its life in, and the one that has to match the real panel
  // exactly, so it is drawn directly rather than as ~20k individual cells.
  // `copy` replaces the whole surface, which clears and fills in one pass.
  function fullPanel(e) {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'copy';
    ctx.fillStyle = SOLID;
    ctx.fillRect(e.l, 0, e.r - e.l, ch);
    ctx.globalCompositeOperation = 'source-over';
    for (var fi = 0; fi < FEATHER.length; fi++) {
      ctx.globalAlpha = FEATHER[fi];
      ctx.fillRect(e.l - (fi + 1) * CELL, 0, CELL, ch);
      ctx.fillRect(e.r + fi * CELL, 0, CELL, ch);
    }
    ctx.globalAlpha = 1;
  }

  // The canvas is never cleared between frames: a cell only ever gets more
  // opaque as it settles, so each state paints over the last. A frame therefore
  // costs the cells that changed since the previous one -- the leading edge --
  // rather than the whole panel, and there is no full-surface blit at all.
  function paint(p) {
    build();
    var e = ensureCells();
    var pp = p * span;
    var n = cellN, i, k;

    if (p >= 1) { fullPanel(e); settledAt = arrivedAt = n; drawnPP = pp; return; }

    // A jump (rather than a step of an animation) means the canvas contents
    // can't be trusted as a starting point, so start again from empty.
    if (drawnPP < 0 || Math.abs(pp - drawnPP) > LIFE * 3) {
      ctx.clearRect(0, 0, cw, ch);
      settledAt = arrivedAt = 0;
    }
    drawnPP = pp;

    // Cells that have finished: drawn once, at full size, and then left alone.
    ctx.fillStyle = SOLID;
    var oa = -1;
    while (settledAt < n && cellD[i = order[settledAt]] + LIFE <= pp) {
      if (cellM[i] !== oa) { ctx.globalAlpha = oa = cellM[i]; }
      ctx.fillRect(cellX[i], cellY[i], CELL, CELL);
      settledAt++;
    }
    while (settledAt > 0 && cellD[i = order[settledAt - 1]] + LIFE > pp) {
      settledAt--;
      ctx.clearRect(cellX[i], cellY[i], CELL, CELL);
    }

    // Cells that have not arrived yet must be cleared when the sweep runs
    // backwards, so the panel comes apart the same way it came together.
    while (arrivedAt < n && cellD[order[arrivedAt]] <= pp) arrivedAt++;
    while (arrivedAt > 0 && cellD[i = order[arrivedAt - 1]] > pp) {
      arrivedAt--;
      ctx.clearRect(cellX[i], cellY[i], CELL, CELL);
    }

    // Cells in flight: the panel's colour at full opacity, still carrying the
    // rain's 1px gap. One pass, one fill colour. Feather cells are skipped --
    // they are translucent, so repainting them would stack alpha; they simply
    // appear at full strength when they settle.
    ctx.globalAlpha = 1;
    for (k = settledAt; k < arrivedAt; k++) {
      i = order[k];
      if (cellM[i] !== 1) continue;
      ctx.fillRect(cellX[i], cellY[i], CELL - 1, CELL - 1);
    }
    ctx.globalAlpha = 1;
  }

  // The original stretched rectangle, kept as a reference to compare against.
  function paintSolid(p) {
    build();
    var e = edges();
    var mid = (e.l + e.r) / 2, halfW = (e.r - e.l) / 2;
    var hw = Math.round(halfW * p / CELL) * CELL;
    if (hw < CELL / 2) hw = CELL / 2;
    ctx.clearRect(0, 0, cw, ch);
    ctx.globalAlpha = 1;
    ctx.fillStyle = SOLID;
    ctx.fillRect(mid - hw, 0, hw * 2, ch);
    var done = hw >= halfW - 0.5;
    for (var fi = 0; fi < FEATHER.length; fi++) {
      ctx.globalAlpha = done ? FEATHER[fi] : 0;
      ctx.fillRect(mid - hw - (fi + 1) * CELL, 0, CELL, ch);
      ctx.fillRect(mid + hw + fi * CELL, 0, CELL, ch);
    }
    ctx.globalAlpha = 1;
  }

  function render(p) { if (style === 'solid') { drawnPP = -1; paintSolid(p); } else paint(p); }

  // While the stand-in is up but not animating, keep it locked to the panel
  // every frame. The page underneath is not static during a navigation: markup
  // arrives, images load and change its height, and a scrollbar can appear or
  // disappear -- each of which moves the real panel sideways.
  var watchRaf = 0, animating = false;
  function watch() {
    watchRaf = 0;
    if (!el || el.style.display !== 'block') return;
    if (!animating) { size(); render(1); }
    watchRaf = requestAnimationFrame(watch);
  }
  function startWatch() { if (!watchRaf) watchRaf = requestAnimationFrame(watch); }
  function stopWatch() { if (watchRaf) { cancelAnimationFrame(watchRaf); watchRaf = 0; } }

  // Both pixel styles start and end empty, so the panel always assembles and
  // comes apart one cell at a time rather than snapping to a first state.
  function floorP() { return 0; }

  function run(from, to, ms) {
    return new Promise(function (done) {
      var c = build();
      own(true);
      animating = true;
      c.style.display = 'block';
      c.style.opacity = '1';
      render(from);
      var t0 = null;
      (function step(now) {
        if (t0 === null) t0 = now;
        var t = Math.min(1, (now - t0) / ms);
        render(from + (to - from) * ease(t));
        if (t < 1) requestAnimationFrame(step);
        else { render(to); animating = false; done(); }
      })(performance.now());
    });
  }

  window.addEventListener('resize', function () {
    if (el && el.style.display === 'block') { size(); render(1); }
  });

  // Build the cell list up front. It is the same geometry the first navigation
  // will use, and doing it here keeps a ~20k-cell build (and the JIT warm-up
  // that comes with it) off the first frame of the animation.
  setTimeout(function () { try { build(); ensureCells(); } catch (e) {} }, 0);

  return {
    setStyle: function (s) { style = s; cellsKey = ''; },
    // testing hook: render one frame of the sweep at a fixed position
    __paint: function (p) { build(); el.style.display = 'block'; own(true); render(p); },
    // hold the cover steady at full size (used while contents swap)
    hold: function () {
      var c = build();
      own(true);
      c.style.opacity = '1';
      c.style.display = 'block';
      render(1);
      startWatch();
    },
    hide: function () {
      stopWatch();
      if (el) { el.style.display = 'none'; }
      own(false);
    },
    expand: function () { return run(floorP(), 1, cfg().expand).then(startWatch); },
    retract: function () {
      return run(1, floorP(), cfg().retract).then(function () {
        var c = build();
        stopWatch();
        if (!c.animate) { c.style.display = 'none'; own(false); return; }
        var a = c.animate([{ opacity: 1 }, { opacity: 0 }],
                          { duration: LINE_FADE, easing: 'ease', fill: 'both' });
        return a.finished.then(function () {
          a.cancel();
          c.style.display = 'none';
          c.style.opacity = '1';
          own(false);
        }, function () {});
      });
    }
  };
})();
