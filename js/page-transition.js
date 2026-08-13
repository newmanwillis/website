// page-transition.js — the project pages' centre cover panel, used as the
// transition between the grid and a project.
//
// The panel is normally .page-content::before, whose edges animation.js
// snaps to the 8px column grid and feathers with four stepped columns.
// During a navigation the real panel is inside the content being swapped,
// so this module paints a stand-in with identical geometry underneath the
// content layer, animates it, and hands back once the real one is in place.
window.PageTransition = (function () {
  'use strict';

  var CELL = 8;
  var BG = '#f5f4f0';
  var STEP_ALPHA = [0.8, 0.6, 0.4, 0.2];   // inner -> outer, matches animation.js
  var EXPAND_MS = 380, RETRACT_MS = 320, LINE_FADE = 130;
  // A heavily front-loaded curve (e.g. 0.22,1,0.36,1) reaches ~two thirds of
  // the width in the first third of its time and reads as a snap. This one
  // eases in and out, so the panel feels like it is being drawn open.
  var EASE = 'cubic-bezier(0.45, 0.05, 0.2, 1)';

  var el = null;

  // Where the real panel's edges are, snapped to the same grid animation.js
  // snaps them to, so the stand-in and the real cover land on the same pixels.
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
      var cw = document.documentElement.clientWidth || iw;
      var maxW = Math.min(cw, Math.min(1200, Math.max(1020, iw * 0.68)));
      l = (cw - maxW) / 2; r = l + maxW;
    }
    return { l: Math.floor(l / CELL) * CELL, r: Math.ceil(r / CELL) * CELL };
  }

  // Raised while the stand-in is on screen. animation.js checks this and
  // stops drawing its own edge feathering, so exactly one layer of feathering
  // exists at every moment and the hand-off is a straight swap.
  function own(v) { window.__ptCover = !!v; }

  function build() {
    if (el && el.isConnected) return el;
    el = document.createElement('div');
    el.id = 'pt-cover';
    var steps = '';
    STEP_ALPHA.forEach(function (a, i) {
      var off = (i + 1) * CELL;
      steps += '<span class="pt-step" style="left:' + (-off) + 'px;background:rgba(245,244,240,' + a + ')"></span>';
      steps += '<span class="pt-step" style="right:' + (-off) + 'px;background:rgba(245,244,240,' + a + ')"></span>';
    });
    el.innerHTML = steps;
    document.body.appendChild(el);
    return el;
  }

  // Place the panel by explicit left/width -- both snapped to the 8px column
  // grid. Snapping matters: the feathered edge columns are 8px wide and must
  // sit ON the grid, exactly as animation.js draws them. Animating width
  // smoothly puts the edge on fractional pixels, which antialiases the steps
  // into one soft edge and then visibly snaps when the real cover takes over.
  function place(l, r) {
    var c = build();
    if (r - l < CELL) r = l + CELL;
    c.style.left = l + 'px';
    c.style.width = (r - l) + 'px';
  }

  function placeFrac(f) {
    var e = edges();
    var cx = (e.l + e.r) / 2, half = (e.r - e.l) / 2;
    var h = half * f;
    place(Math.round((cx - h) / CELL) * CELL, Math.round((cx + h) / CELL) * CELL);
  }

  // cubic-bezier evaluated in JS so the per-frame width can be quantised
  function bezier(x1, y1, x2, y2) {
    function A(a, b) { return 1 - 3 * b + 3 * a; }
    function B(a, b) { return 3 * b - 6 * a; }
    function C(a) { return 3 * a; }
    function calc(t, a, b) { return ((A(a, b) * t + B(a, b)) * t + C(a)) * t; }
    function slope(t, a, b) { return 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a); }
    return function (x) {
      var t = x;
      for (var i = 0; i < 6; i++) {
        var sl = slope(t, x1, x2);
        if (Math.abs(sl) < 1e-6) break;
        t -= (calc(t, x1, x2) - x) / sl;
      }
      return calc(t, y1, y2);
    };
  }
  var ease = bezier(0.45, 0.05, 0.2, 1);

  // While the stand-in is up but not animating, keep it locked to the panel
  // every frame. The page underneath is not static during a navigation: the new
  // markup arrives, images load and change its height, and a scrollbar can
  // appear or disappear -- each of which moves the real panel sideways. One
  // measurement taken up front would be stale by the time we hand back.
  var watchRaf = 0, animating = false;
  function watch() {
    watchRaf = 0;
    if (!el || el.style.display !== 'block') return;
    if (!animating) placeFrac(1);
    watchRaf = requestAnimationFrame(watch);
  }
  function startWatch() { if (!watchRaf) watchRaf = requestAnimationFrame(watch); }
  function stopWatch() { if (watchRaf) { cancelAnimationFrame(watchRaf); watchRaf = 0; } }

  function animateFrac(fromF, toF, ms) {
    return new Promise(function (done) {
      var c = build();
      own(true);
      animating = true;
      c.style.display = 'block';
      c.style.opacity = '1';
      placeFrac(fromF);
      var t0 = null;
      (function step(now) {
        if (t0 === null) t0 = now;
        var p = Math.min(1, (now - t0) / ms);
        placeFrac(fromF + (toF - fromF) * ease(p));
        if (p < 1) requestAnimationFrame(step);
        else { placeFrac(toF); animating = false; done(); }
      })(performance.now());
    });
  }

  function minFrac() {
    var e = edges();
    return (CELL / 2) / ((e.r - e.l) / 2);   // start/end as one 8px column
  }

  return {
    // hold the cover steady at full size (used while contents swap)
    hold: function () {
      var c = build();
      own(true);
      c.style.opacity = '1';
      c.style.display = 'block';
      placeFrac(1);
      startWatch();
    },
    hide: function () {
      stopWatch();
      if (el) { el.style.display = 'none'; }
      own(false);
    },
    // grow outward from the centre column
    expand: function () {
      return animateFrac(minFrac(), 1, EXPAND_MS).then(startWatch);
    },
    // pull back into the centre column, then blink it out
    retract: function () {
      return animateFrac(1, minFrac(), RETRACT_MS).then(function () {
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
