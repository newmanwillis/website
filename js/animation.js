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

  var INTERACTIVE = false; // change to true to enable mouse/click effects

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

  // mouse water wave parameters
  var WATER_INNER_R    = CELL * 2;   // 16px — cursor/trail clear zone radius (temporary, fades back)
  var WAVE_SPEED       = 50;         // px/s — wave expands perpendicular to motion
  var WAVE_WIDTH       = CELL * 2;   // 16px — wave band thickness
  var WAVE_ALPHA       = 0.12;       // max darkening at wave crest (on top of ambient)
  var WAVE_PAR_WIDTH   = CELL * 5;   // 40px — wave extent along direction of motion
  var WATER_TRAIL_AGE  = 1800;       // ms — trail point lifetime
  var TRAIL_MIN_SQ     = CELL * CELL;// min squared distance between trail points
  var MAX_TRAIL_POINTS = 80;
  var INNER_R_SQ       = WATER_INNER_R * WATER_INNER_R;
  var WAKE_DURATION    = 2600;       // ms — time for a woken pixel to return to full ambient

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
    if (p.state === 'cleared' || p.state === 'waking') return 0;
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
  // Per-pixel wave darkening, recomputed each frame (positive values only).
  // Separate from the permanent cleared/tinted state so the wave effect is temporary.
  var mouseRipple = null;

  function initGrid() {
    cols = Math.ceil(w / CELL);
    rows = Math.ceil(h / CELL);

    pixels = [];
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < cols; x++) {
        var initDark = randAmbient();
        pixels.push({
          x: x, y: y,
          phase: Math.random() * Math.PI * 2,
          speed: 0.0002 + Math.random() * 0.00022,
          ambMin: Math.max(AMB_MIN, initDark - 0.015),
          ambMax: Math.min(AMB_MAX, initDark + 0.015),
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

    mouseRipple = new Float32Array(cols * rows);
    mouseTrail = [];

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
        p.seededDark = randAmbient(); p.seededArmed = true;
        p.flashAlpha = LEAD_DARK; p.rippleAlpha = 0; p.state = 'flashing';
      }
    }
  }

  // ── Mouse & trail tracking ──
  // Both the clear zone and the wave darkening are TEMPORARY (stored in mouseRipple[],
  // recomputed each frame). Negative values = clearing (water parting), positive = wave
  // darkening. Everything returns to ambient oscillation as trail points age and expire.
  var mouseX = -1000, mouseY = -1000;
  var mouseTrail = [];
  var lastTrailX = -9999, lastTrailY = -9999;

  // Set pixels within WATER_INNER_R of (cx, cy) to 'waking' state.
  // First contact randomises the ambient target; cursor refreshes keep wakeStartTime = now
  // so the pixel stays invisible while the cursor is there, then self-recovers once it moves.
  function applyWakeAt(cx, cy, now) {
    var xMinC = Math.max(0, Math.floor((cx - WATER_INNER_R) / CELL));
    var xMaxC = Math.min(cols - 1, Math.ceil((cx + WATER_INNER_R) / CELL));
    var yMinC = Math.max(0, Math.floor((cy - WATER_INNER_R) / CELL));
    var yMaxC = Math.min(rows - 1, Math.ceil((cy + WATER_INNER_R) / CELL));
    for (var gx = xMinC; gx <= xMaxC; gx++) {
      for (var gy = yMinC; gy <= yMaxC; gy++) {
        var pcx = gx * CELL + CELL / 2, pcy = gy * CELL + CELL / 2;
        var ddx = pcx - cx, ddy = pcy - cy;
        if (ddx * ddx + ddy * ddy > INNER_R_SQ) continue;
        var p = grid[gx * rows + gy];
        if (!p || p.state === 'flashing') continue;
        if (p.state !== 'waking') {
          // First contact: assign a random ambient target for this recovery
          p.ambMin = AMB_MIN + Math.random() * 0.02;
          p.ambMax = AMB_MIN + 0.02 + Math.random() * (AMB_MAX - AMB_MIN - 0.02);
        }
        p.state = 'waking';
        p.wakeStartTime = now; // kept at 'now' each frame under cursor → stays invisible
      }
    }
  }

  function addTrailPoint(x, y, now) {
    if (!INTERACTIVE) return;
    var dx = x - lastTrailX, dy = y - lastTrailY;
    var distSq = dx * dx + dy * dy;
    if (distSq < TRAIL_MIN_SQ) return;
    var vx = 0, vy = 0;
    if (lastTrailX > -9000) {
      var len = Math.sqrt(distSq);
      vx = dx / len; vy = dy / len;
    }
    applyWakeAt(x, y, now);
    mouseTrail.push({ x: x, y: y, born: now, vx: vx, vy: vy });
    if (mouseTrail.length > MAX_TRAIL_POINTS) mouseTrail.shift();
    lastTrailX = x; lastTrailY = y;
  }

  document.addEventListener('mousemove', function(e) {
    mouseX = e.clientX; mouseY = e.clientY;
    addTrailPoint(mouseX, mouseY, performance.now());
  });
  document.addEventListener('mouseleave', function() {
    mouseX = -1000; mouseY = -1000;
    lastTrailX = -9999; lastTrailY = -9999;
  });
  document.addEventListener('touchmove', function(e) {
    mouseX = e.touches[0].clientX; mouseY = e.touches[0].clientY;
    addTrailPoint(mouseX, mouseY, performance.now());
  }, { passive: true });
  document.addEventListener('touchend', function() {
    mouseX = -1000; mouseY = -1000;
    lastTrailX = -9999; lastTrailY = -9999;
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

  // ── Mouse water effect (per-frame, temporary) ──
  // mouseRipple[] is rebuilt every frame with two kinds of values:
  //   positive → wave darkening (displaced water pushed outward)
  //   negative → clear zone (water parted by cursor/trail, fading back to equilibrium)
  // All effects fade as trail points age and return to 0 when they expire.
  // The cursor position holds full-strength clearing while on canvas.
  function updateMouseRipple(now) {
    if (!mouseRipple) return;
    mouseRipple.fill(0);

    // Purge expired trail points
    while (mouseTrail.length > 0 && now - mouseTrail[0].born > WATER_TRAIL_AGE) {
      mouseTrail.shift();
    }

    // Wave bands — positive darkening that spreads perpendicular to motion.
    // A per-pixel ray march from the trail to each candidate pixel stops the wave
    // wherever a flashing column pixel sits in between.
    for (var ti = 0; ti < mouseTrail.length; ti++) {
      var tp = mouseTrail[ti];
      if (!tp.vx && !tp.vy) continue;

      var age = now - tp.born;
      var lifeFrac = 1 - age / WATER_TRAIL_AGE;
      var wavePerpR = WATER_INNER_R + age * WAVE_SPEED / 1000;
      var bbR = wavePerpR + WAVE_WIDTH + CELL;

      var xMinC = Math.max(0, Math.floor((tp.x - bbR) / CELL));
      var xMaxC = Math.min(cols - 1, Math.ceil((tp.x + bbR) / CELL));
      var yMinC = Math.max(0, Math.floor((tp.y - bbR) / CELL));
      var yMaxC = Math.min(rows - 1, Math.ceil((tp.y + bbR) / CELL));

      var pvx = -tp.vy, pvy = tp.vx;

      for (var cx = xMinC; cx <= xMaxC; cx++) {
        for (var cy = yMinC; cy <= yMaxC; cy++) {
          var pcx = cx * CELL + CELL / 2, pcy = cy * CELL + CELL / 2;
          var ddx = pcx - tp.x, ddy = pcy - tp.y;

          var parProj = ddx * tp.vx + ddy * tp.vy;  // signed: + = forward
          var parDist = parProj < 0 ? -parProj : parProj;

          var perpProj = ddx * pvx + ddy * pvy;
          var perpDist = perpProj < 0 ? -perpProj : perpProj;

          // Effective wave radius: circular arc in front, straight bars on the sides/back.
          // For parProj <= 0 this equals perpDist (existing side-wave behavior).
          var fwd = parProj > 0 ? parProj : 0;
          var distEff = Math.sqrt(fwd * fwd + perpProj * perpProj);

          var bandDist = distEff - wavePerpR;
          if (bandDist < 0) bandDist = -bandDist;
          if (bandDist > WAVE_WIDTH) continue;

          // Backward/side portion: fade based on parallel distance so bars have finite length.
          var parTaper;
          if (parProj <= 0) {
            if (parDist > WAVE_PAR_WIDTH) continue;
            var parNorm = parDist / WAVE_PAR_WIDTH;
            parTaper = 1 - parNorm * parNorm;
          } else {
            parTaper = 1;
          }

          var leadColRow = Math.floor(columns[cx].y);
          var leadPerpProj = ddx * pvx + (leadColRow * CELL + CELL * 0.5 - tp.y) * pvy;
          if (leadPerpProj * perpProj > 0 && Math.abs(leadPerpProj) < perpDist) continue;

          var perpProfile = 1 - bandDist / WAVE_WIDTH;
          var darkVal = WAVE_ALPHA * perpProfile * parTaper * lifeFrac;
          if (darkVal < 0.01) continue;

          var idx = cx * rows + cy;
          if (darkVal > mouseRipple[idx]) mouseRipple[idx] = darkVal;
        }
      }
    }

    // Cursor — refresh waking state each frame so it stays invisible while hovering.
    // wakeStartTime is reset to 'now' every frame, so the pixel only starts recovering
    // once the cursor moves away and the refreshes stop.
    if (mouseX >= 0 && mouseX < w && mouseY >= 0 && mouseY < h) {
      applyWakeAt(mouseX, mouseY, now);
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

        p.seededDark = randAmbient(); p.seededArmed = true;
        p.flashAlpha = LEAD_DARK; p.rippleAlpha = 0; p.state = 'flashing';
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
    advanceColumns(dt);
    if (INTERACTIVE) {
      applyRipples(now, t);
      updateMouseRipple(now);  // fills mouseRipple[] fresh every frame
    }

    ctx.fillStyle = '#f5f4f0';
    ctx.fillRect(0, 0, w, h);

    for (var i = 0; i < pixels.length; i++) {
      var p = pixels[i];
      var px = p.x * CELL, py = p.y * CELL;

      // Cleared by click ripple — show background
      if (p.state === 'cleared') continue;

      var inf = mouseRipple ? mouseRipple[p.x * rows + p.y] : 0;

      if (p.state === 'flashing') {
        // Column streak — not affected by mouse water effects
        p.flashAlpha -= FLASH_DECAY * dt;
        if (p.seededArmed && p.flashAlpha <= p.seededDark) {
          p.ambMin = Math.max(AMB_MIN, p.seededDark - 0.015);
          p.ambMax = Math.min(AMB_MAX, p.seededDark + 0.015);
          p.phase = 0; p.seededArmed = false; p.state = 'ambient';
        }
        if (p.flashAlpha <= AMB_MIN) { p.seededArmed = false; p.state = 'ambient'; }
        if (p.state === 'flashing') {
          ctx.fillStyle = fillColor(Math.min(LEAD_DARK, Math.max(0, p.flashAlpha)));
          ctx.fillRect(px, py, CELL - 1, CELL - 1);
          continue;
        }
      }

      if (p.state === 'tinted') {
        // From click ripple
        var alpha = p.rippleAlpha;
        if (inf > 0) alpha = Math.min(LEAD_DARK, alpha + inf);
        if (alpha <= 0.001) continue;
        ctx.fillStyle = fillColor(alpha);
        ctx.fillRect(px, py, CELL - 1, CELL - 1);
        continue;
      }

      if (p.state === 'waking') {
        // Pixel was touched by the mouse; it starts at 0 and independently oscillates
        // back toward its ambient target over WAKE_DURATION ms.
        var prog = Math.min(1, (now - p.wakeStartTime) / WAKE_DURATION);
        var wave = 0.5 + 0.5 * Math.sin(t * p.speed + p.phase);
        var darkness = (p.ambMin + (p.ambMax - p.ambMin) * wave) * prog;
        if (prog >= 1) p.state = 'ambient';
        if (darkness > 0.001) {
          ctx.fillStyle = fillColor(darkness);
          ctx.fillRect(px, py, CELL - 1, CELL - 1);
        }
        continue;
      }

      // Ambient: wave darkening (positive inf only — no negative inf now).
      var wave = 0.5 + 0.5 * Math.sin(t * p.speed + p.phase);
      var darkness = p.ambMin + (p.ambMax - p.ambMin) * wave;
      if (inf > 0) darkness = Math.min(LEAD_DARK, darkness + inf);

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
