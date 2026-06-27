(function() {
  var canvasEl = document.getElementById('bg-canvas');
  if (!canvasEl) return;
  var dpr = window.devicePixelRatio || 1;
  var w = window.innerWidth;
  var h = window.innerHeight;
  canvasEl.width = w * dpr;
  canvasEl.height = h * dpr;
  var ctx = canvasEl.getContext('2d');
  ctx.scale(dpr, dpr);

  var CELL = 8;
  var cols, rows;
  var BASE_R = 58, BASE_G = 56, BASE_B = 48;
  var AMB_MIN = 0.03, AMB_MAX = 0.13, LEAD_DARK = 0.16;
  var TRAIL_LEN = 10;
  var RIPPLE_MAX_R = 130;
  var RIPPLE_LIFE = 2000;
  var FLASH_DECAY = 0.0015;

  // click ripple zones (in px from click point)
  var RIPPLE_CLEAR_R = 4 * CELL;
  var RIPPLE_TARGET_MAX = AMB_MAX * 0.70;

  // mouse glitch trail parameters
  var GLITCH_DURATION = 500;        // ms — how long a glitched pixel stays glitched
  var EMERGE_DURATION = 2500;       // ms — slow fade-in from background after glitch clears
  // Warm-grey variations of the base pixel color rgba(58,56,48) — toned down glitch palette
  var GLITCH_COLORS = [
    'rgba(58,56,48,',    // base
    'rgba(82,76,62,',    // lighter warm
    'rgba(36,34,30,',    // darker
    'rgba(72,66,54,',    // warm mid
    'rgba(44,46,52,',    // slightly cool
    'rgba(96,90,76,',    // lightest
    'rgba(50,46,40,',    // muted warm
    'rgba(28,28,32,',    // near-black cool
  ];

  function easeOut(t) { var inv = 1 - t; return 1 - inv * inv * inv; }
  function randAmbient() { return AMB_MIN + Math.random() * (AMB_MAX - AMB_MIN); }
  function randSpeed() { return 0.003 + Math.random() * 0.007; }

  var alphaCache = {};
  function fillColor(a) {
    var key = (a * 1000 | 0);
    if (!alphaCache[key]) alphaCache[key] = 'rgba(' + BASE_R + ',' + BASE_G + ',' + BASE_B + ',' + a.toFixed(3) + ')';
    return alphaCache[key];
  }

  function currentDarkness(p, t) {
    if (p.state === 'cleared') return 0;
    if (p.state === 'flashing') return Math.max(0, p.flashAlpha);
    if (p.state === 'tinted') return p.rippleAlpha;
    var wave = 0.5 + 0.5 * Math.sin(t * p.speed + p.phase);
    return p.ambMin + (p.ambMax - p.ambMin) * wave;
  }

  function rippleTarget(dist) {
    if (dist <= RIPPLE_CLEAR_R) return { mode: 'clear', targetAlpha: 0 };
    var outerFrac = Math.min(1, (dist - RIPPLE_CLEAR_R) / (RIPPLE_MAX_R - RIPPLE_CLEAR_R));
    return { mode: 'lighten', targetAlpha: RIPPLE_TARGET_MAX * outerFrac };
  }

  var pixels = [];
  var grid = [];
  var columns = [];

  function initGrid() {
    cols = Math.ceil(w / CELL);
    rows = Math.ceil(h / CELL);

    pixels = [];
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < cols; x++) {
        pixels.push({
          x: x, y: y,
          phase: Math.random() * Math.PI * 2,
          speed: 0.0002 + Math.random() * 0.00022,
          ambMin: AMB_MIN + Math.random() * 0.02,
          ambMax: AMB_MIN + 0.02 + Math.random() * (AMB_MAX - AMB_MIN - 0.02),
          seededDark: randAmbient(),
          seededArmed: false,
          flashAlpha: 0,
          state: 'ambient',
          rippleAlpha: 0
        });
      }
    }

    grid = new Array(cols * rows);
    pixels.forEach(function(p) { grid[p.x * rows + p.y] = p; });


    // columns: stratified random vertical distribution
    columns = [];
    var extendedRows = rows + TRAIL_LEN * 2;
    var segment = extendedRows / Math.max(1, cols);
    var positions = [];
    for (var i = 0; i < cols; i++) {
      var center = (i + 0.5) * segment;
      var jitter = (Math.random() - 0.5) * segment * 0.5;
      positions.push(Math.max(-TRAIL_LEN, Math.min(rows + TRAIL_LEN, center + jitter - TRAIL_LEN)));
    }
    for (var i = positions.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = positions[i]; positions[i] = positions[j]; positions[j] = temp;
    }
    for (var x = 0; x < cols; x++) {
      var colY = positions[x];
      columns.push({ y: colY, speed: randSpeed() });
      for (var k = 0; k < TRAIL_LEN; k++) {
        var gy = Math.floor(colY) - k;
        if (gy < 0 || gy >= rows) continue;
        var p = grid[x * rows + gy];
        if (!p) continue;
        p.flashAlpha = LEAD_DARK; p.rippleAlpha = 0; p.state = 'flashing';
        if (k === 0) {
          p.seededDark = randAmbient(); p.seededSpeed = 0.0002 + Math.random() * 0.00022; p.seededPhase = Math.random() * Math.PI * 2; p.seededArmed = true;
        } else {
          p.seededArmed = false;
        }
      }
    }
  }

  // ── Mouse glitch trail ──
  var mouseX = -1000, mouseY = -1000;
  var prevMouseX = -1000, prevMouseY = -1000;  // for path interpolation between events
  var glitchIntensity = 0;     // 0–1, builds with movement time, decays slowly at rest
  var glitchLastMoveTime = 0;  // for time-based ramp

  // Radius grows from CELL*1.2 (subtle cursor dot) to CELL*3 (wide spread) as intensity rises.
  function applyGlitchAt(cx, cy, now) {
    var radius = CELL * (1.2 + 1.8 * glitchIntensity);
    var rSq = radius * radius;
    var xMinC = Math.max(0, Math.floor((cx - radius) / CELL));
    var xMaxC = Math.min(cols - 1, Math.ceil((cx + radius) / CELL));
    var yMinC = Math.max(0, Math.floor((cy - radius) / CELL));
    var yMaxC = Math.min(rows - 1, Math.ceil((cy + radius) / CELL));
    for (var gx = xMinC; gx <= xMaxC; gx++) {
      for (var gy = yMinC; gy <= yMaxC; gy++) {
        var pcx = gx * CELL + CELL / 2, pcy = gy * CELL + CELL / 2;
        var ddx = pcx - cx, ddy = pcy - cy;
        if (ddx * ddx + ddy * ddy > rSq) continue;
        var p = grid[gx * rows + gy];
        if (!p || p.state === 'flashing' || p.state === 'cleared') continue;
        p.state = 'glitching';
        p.glitchStart = now;
        p.newAmbMin = AMB_MIN + Math.random() * 0.02;
        p.newAmbMax = AMB_MIN + 0.02 + Math.random() * (AMB_MAX - AMB_MIN - 0.02);
        p.newSpeed = 0.0002 + Math.random() * 0.00022; p.newPhase = Math.random() * Math.PI * 2;
      }
    }
  }

  function stampGlitchPath(cx, cy, now) {
    if (prevMouseX > -500) {
      // Interpolate from previous position so fast movement fills the full path.
      var dx = cx - prevMouseX, dy = cy - prevMouseY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var steps = Math.ceil(dist / CELL);
      for (var i = 1; i <= steps; i++) {
        applyGlitchAt(prevMouseX + dx * i / steps, prevMouseY + dy * i / steps, now);
      }
    } else {
      applyGlitchAt(cx, cy, now);
    }
  }

  document.addEventListener('mousemove', function(e) {
    var now = performance.now();
    var moveDt = Math.min(now - glitchLastMoveTime, 100);  // cap gaps (e.g. after tab switch)
    glitchLastMoveTime = now;
    glitchIntensity = Math.min(1, glitchIntensity + moveDt / 2000);
    stampGlitchPath(e.clientX, e.clientY, now);
    prevMouseX = e.clientX; prevMouseY = e.clientY;
    mouseX = e.clientX; mouseY = e.clientY;
  });
  document.addEventListener('mouseleave', function() {
    mouseX = -1000; mouseY = -1000;
    prevMouseX = -1000; prevMouseY = -1000;
  });
  document.addEventListener('touchmove', function(e) {
    var now = performance.now();
    var moveDt = Math.min(now - glitchLastMoveTime, 100);
    glitchLastMoveTime = now;
    glitchIntensity = Math.min(1, glitchIntensity + moveDt / 2000);
    var tx = e.touches[0].clientX, ty = e.touches[0].clientY;
    stampGlitchPath(tx, ty, now);
    prevMouseX = tx; prevMouseY = ty;
    mouseX = tx; mouseY = ty;
  }, { passive: true });
  document.addEventListener('touchend', function() {
    mouseX = -1000; mouseY = -1000;
    prevMouseX = -1000; prevMouseY = -1000;
  });

  // ── Click ripples ──
  var ripples = [];
  function addRipple(rx, ry) {
    ripples.push({ x: rx, y: ry, lastR: 0, born: performance.now() });
    if (ripples.length > 5) ripples.shift();
  }
  document.addEventListener('click', function(e) { addRipple(e.clientX, e.clientY); });
  document.addEventListener('touchstart', function(e) {
    addRipple(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

  function applyRipples(now, t) {
    var i = ripples.length;
    while (i--) {
      var rp = ripples[i];
      var age = now - rp.born;
      if (age > RIPPLE_LIFE) { ripples.splice(i, 1); continue; }
      var waveR = RIPPLE_MAX_R * easeOut(age / RIPPLE_LIFE);
      var rMin = rp.lastR, rMax = waveR;
      rp.lastR = waveR;
      if (rMax - rMin < 0.3) continue;
      var outerR = rMax + CELL;
      var xMinC = Math.max(0, Math.floor((rp.x - outerR) / CELL));
      var xMaxC = Math.min(cols - 1, Math.ceil((rp.x + outerR) / CELL));
      var yMinC = Math.max(0, Math.floor((rp.y - outerR) / CELL));
      var yMaxC = Math.min(rows - 1, Math.ceil((rp.y + outerR) / CELL));
      for (var cx = xMinC; cx <= xMaxC; cx++) {
        for (var cy = yMinC; cy <= yMaxC; cy++) {
          var pcx = cx * CELL + CELL / 2, pcy = cy * CELL + CELL / 2;
          var dx = pcx - rp.x, dy = pcy - rp.y;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < rMin || dist > rMax) continue;
          var p = grid[cx * rows + cy];
          if (!p || p.state === 'flashing') continue;
          var target = rippleTarget(dist);
          var curDark = currentDarkness(p, t);
          if (target.mode === 'clear') {
            p.state = 'cleared'; p.seededArmed = false; p.rippleAlpha = 0;
          } else if (curDark > target.targetAlpha) {
            p.rippleAlpha = target.targetAlpha;
            p.state = target.targetAlpha <= 0 ? 'cleared' : 'tinted';
            p.seededArmed = false;
          }
        }
      }
    }
  }

  function advanceColumns(dt) {
    for (var x = 0; x < cols; x++) {
      var col = columns[x];
      var prevY = col.y;
      col.y += col.speed * dt;
      if (col.y > rows + TRAIL_LEN + 2) {
        col.y = -TRAIL_LEN - Math.random() * rows * 0.5;
        col.speed = randSpeed();
      }
      var fromY = Math.floor(prevY), toY = Math.floor(col.y);
      for (var gy = fromY; gy <= toY; gy++) {
        if (gy < 0 || gy >= rows) continue;
        var p = grid[x * rows + gy];
        if (!p) continue;

        p.flashAlpha = LEAD_DARK; p.rippleAlpha = 0; p.state = 'flashing';
        if (gy === toY) {
          p.seededDark = randAmbient(); p.seededSpeed = 0.0002 + Math.random() * 0.00022; p.seededPhase = Math.random() * Math.PI * 2; p.seededArmed = true;
        } else {
          p.seededArmed = false;
        }
      }
    }
  }

  // Snap the ::before panel edges to the pixel-column grid (CELL=8px) so
  // hard panel edges always land in the 1px gap between columns.
  var fadeEdgeL = -1, fadeEdgeR = -1;
  var panelStyle = null;
  var cachedContent = null;
  function alignPanels() {
    if (!cachedContent) cachedContent = document.querySelector('.page-content');
    var content = cachedContent;
    if (!content) {
      if (fadeEdgeL !== -1 || fadeEdgeR !== -1) {
        fadeEdgeL = -1; fadeEdgeR = -1;
        if (panelStyle) panelStyle.textContent = '';
      }
      return;
    }
    var vw = window.innerWidth;
    var maxW   = Math.min(vw, Math.min(1200, Math.max(1020, vw * 0.68)));
    var contentL = (vw - maxW) / 2;
    var contentR = contentL + maxW;
    var newEdgeL = Math.floor(contentL / CELL);
    var newEdgeR = Math.ceil(contentR / CELL);
    if (newEdgeL === fadeEdgeL && newEdgeR === fadeEdgeR) return;
    fadeEdgeL = newEdgeL; fadeEdgeR = newEdgeR;
    var cLeft  = fadeEdgeL * CELL - contentL;
    var cRight = contentR - fadeEdgeR * CELL;
    if (!panelStyle) { panelStyle = document.createElement('style'); document.head.appendChild(panelStyle); }
    panelStyle.textContent =
      '.page-content::before{left:' + cLeft + 'px!important;right:' + cRight + 'px!important}';
  }

  var paused = false;
  document.addEventListener('visibilitychange', function() { paused = document.hidden; });
  var observer = new IntersectionObserver(function(entries) { paused = !entries[0].isIntersecting; }, { threshold: 0.01 });
  observer.observe(canvasEl);
  var resizeTimer = null;

  function draw(t, now, dt) {
    // Rapidly drain intensity while mouse is still; no decay while actively moving.
    // Rate: ~0.002/ms means ~0.5 s from full to zero.
    if (now - glitchLastMoveTime > 50) {
      glitchIntensity = Math.max(0, glitchIntensity - 0.002 * dt);
    }
    // Per-frame refresh: stamp glitch at cursor each frame, but only while mouse is moving.
    // Stopping clears the condition so pixels can finish their glitch cycle and size resets.
    if (mouseX >= 0 && mouseX < w && mouseY >= 0 && mouseY < h && now - glitchLastMoveTime < 50) {
      applyGlitchAt(mouseX, mouseY, now);
    }
    advanceColumns(dt);
    applyRipples(now, t);

    ctx.fillStyle = '#f5f4f0';
    ctx.fillRect(0, 0, w, h);

    for (var i = 0; i < pixels.length; i++) {
      var p = pixels[i];
      var px = p.x * CELL, py = p.y * CELL;

      // Cleared by click ripple — show background
      if (p.state === 'cleared') continue;

      if (p.state === 'flashing') {
        // Column streak — not affected by mouse water effects
        p.flashAlpha -= FLASH_DECAY * dt;
        if (p.seededArmed && p.flashAlpha <= p.seededDark) {
          p.ambMin = Math.max(AMB_MIN, p.seededDark - 0.015);
          p.ambMax = Math.min(AMB_MAX, p.seededDark + 0.015);
          p.speed = p.seededSpeed; p.phase = p.seededPhase; p.seededArmed = false; p.state = 'ambient';
        }
        if (p.flashAlpha <= AMB_MIN) { p.seededArmed = false; p.state = 'ambient'; }
        if (p.state === 'flashing') {
          ctx.fillStyle = fillColor(Math.min(LEAD_DARK, Math.max(0, p.flashAlpha)));
          ctx.fillRect(px, py, CELL - 1, CELL - 1);
          continue;
        }
      }

      if (p.state === 'tinted') {
        var alpha = p.rippleAlpha;
        if (alpha <= 0.001) continue;
        ctx.fillStyle = fillColor(alpha);
        ctx.fillRect(px, py, CELL - 1, CELL - 1);
        continue;
      }

      if (p.state === 'glitching') {
        var prog = (now - p.glitchStart) / GLITCH_DURATION;
        if (prog < 1) {
          // Compute where this pixel's ambient oscillation is right now so we can
          // fade toward it rather than toward transparent — no background flash on exit.
          var gwave = 0.5 + 0.5 * Math.sin(t * p.speed + p.phase);
          var ambDark = p.ambMin + (p.ambMax - p.ambMin) * gwave;
          var peakAlpha = 0.14 + 0.26 * glitchIntensity;  // 0.14 (barely visible) → 0.40 (dramatic)
          var galpha = peakAlpha + (ambDark - peakAlpha) * prog;
          // Size varies more at higher intensity; at intensity 0, sz stays at CELL-1 (normal)
          var maxOff = (glitchIntensity * 2.5) | 0;  // 0–2
          var sz = (CELL - 1) - maxOff + (Math.random() * (maxOff * 2 + 1) | 0);
          if (sz < 4) sz = 4; if (sz > 9) sz = 9;
          var off = (CELL - 1 - sz) >> 1;
          ctx.fillStyle = GLITCH_COLORS[Math.random() * GLITCH_COLORS.length | 0] + galpha.toFixed(3) + ')';
          ctx.fillRect(px + off, py + off, sz, sz);
          continue;
        }
        p.ambMin = p.newAmbMin; p.ambMax = p.newAmbMax; p.speed = p.newSpeed; p.phase = p.newPhase;
        p.emergeStart = now;
        p.state = 'emerging';
        continue;
      }

      if (p.state === 'emerging') {
        var eprog = (now - p.emergeStart) / EMERGE_DURATION;
        if (eprog < 1) {
          var ewave = 0.5 + 0.5 * Math.sin(t * p.speed + p.phase);
          var eTarget = p.ambMin + (p.ambMax - p.ambMin) * ewave;
          var ealpha = eTarget * eprog;
          if (ealpha > 0.001) {
            ctx.fillStyle = fillColor(ealpha);
            ctx.fillRect(px, py, CELL - 1, CELL - 1);
          }
          continue;
        }
        p.state = 'ambient';  // fall through to ambient draw
      }

      // Ambient
      var wave = 0.5 + 0.5 * Math.sin(t * p.speed + p.phase);
      var darkness = p.ambMin + (p.ambMax - p.ambMin) * wave;

      if (darkness <= 0.001) continue;
      ctx.fillStyle = fillColor(darkness);
      ctx.fillRect(px, py, CELL - 1, CELL - 1);
    }

    // column streaks (always overdraw pixel state)
    for (var x = 0; x < cols; x++) {
      var col = columns[x];
      for (var k = 0; k < TRAIL_LEN; k++) {
        var gy = Math.floor(col.y) - k;
        if (gy < 0 || gy >= rows) continue;
        var streakAlpha = k < 3
          ? LEAD_DARK - (k / 3) * (LEAD_DARK - AMB_MAX)
          : AMB_MAX * (1 - (k - 3) / (TRAIL_LEN - 3));
        ctx.fillStyle = fillColor(streakAlpha);
        ctx.fillRect(x * CELL, gy * CELL, CELL - 1, CELL - 1);
      }
    }

    // stepped column fade at panel edges
    if (fadeEdgeL >= 0 && fadeEdgeR >= 0) {
      var fadeAlphas = [0.2, 0.4, 0.6, 0.8]; // outer → inner
      ctx.fillStyle = '#f5f4f0';
      for (var fi = 0; fi < fadeAlphas.length; fi++) {
        ctx.globalAlpha = fadeAlphas[fi];
        ctx.fillRect((fadeEdgeL - fadeAlphas.length + fi) * CELL, 0, CELL, h);
        ctx.fillRect((fadeEdgeR + fadeAlphas.length - 1 - fi) * CELL, 0, CELL, h);
      }
      ctx.globalAlpha = 1;
    }
  }

  var start = null, lastT = 0;
  function frame(ts) {
    var vw = window.innerWidth, vh = window.innerHeight;
    var newDpr = window.devicePixelRatio || 1;
    if (canvasEl.width !== Math.round(vw * newDpr) || canvasEl.height !== Math.round(vh * newDpr)) {
      dpr = newDpr;
      canvasEl.width = vw * dpr;
      canvasEl.height = vh * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    alignPanels();
    if (!paused) {
      if (!start) { start = ts; lastT = ts; }
      var t = ts - start;
      var dt = Math.min(ts - lastT, 50);
      lastT = ts;
      draw(t, ts, dt);
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', function() {
    var newW = window.innerWidth, newH = window.innerHeight;
    if (Math.abs(newW - w) <= 30 && Math.abs(newH - h) <= 30) return;
    w = newW; h = newH;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(initGrid, 150);
  });

  window.addEventListener('load', alignPanels);
  window.addEventListener('navstart', function() { fadeEdgeL = -1; fadeEdgeR = -1; cachedContent = null; });
  window.addEventListener('navchange', function() { cachedContent = null; alignPanels(); });

  initGrid();
  alignPanels();
  requestAnimationFrame(frame);
})();
