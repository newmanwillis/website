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
  var BASE_R = 58, BASE_G = 56, BASE_B = 48;  // Dark pixels drawn on light background
  var AMB_MIN = 0.03, AMB_MAX = 0.13, LEAD_DARK = 0.16;
  var TRAIL_LEN = 10;
  var RIPPLE_MAX_R = 130;
  var RIPPLE_LIFE = 2000;
  var FLASH_DECAY = 0.0015;

  // ripple zones (in px from click point)
  var RIPPLE_CLEAR_R = 4 * CELL;           // inner clear zone: 0 to 4 cells out
  var RIPPLE_TARGET_MAX = AMB_MAX * 0.70;  // ~0.091 — max darkness at outer edge

  function easeOut(t) { var inv = 1 - t; return 1 - inv * inv * inv; }
  function randAmbient() { return AMB_MIN + Math.random() * (AMB_MAX - AMB_MIN); }
  function randSpeed() { return 0.003 + Math.random() * 0.007; }

  var alphaCache = {};
  function fillColor(a) {
    var key = (a * 1000 | 0);
    if (!alphaCache[key]) alphaCache[key] = 'rgba(' + BASE_R + ',' + BASE_G + ',' + BASE_B + ',' + a.toFixed(3) + ')';
    return alphaCache[key];
  }

  // get current effective darkness of a pixel for comparison
  function currentDarkness(p, t) {
    if (p.state === 'cleared') return 0;
    if (p.state === 'flashing') return Math.max(0, p.flashAlpha);
    if (p.state === 'tinted') return p.rippleAlpha;
    var wave = 0.5 + 0.5 * Math.sin(t * p.speed + p.phase);
    return p.ambMin + (p.ambMax - p.ambMin) * wave;
  }

  // compute what the ripple wants to do at a given pixel distance from click
  // returns { mode: 'clear' | 'lighten', targetAlpha: number }
  function rippleTarget(dist) {
    if (dist <= RIPPLE_CLEAR_R) {
      return { mode: 'clear', targetAlpha: 0 };
    }
    // from RIPPLE_CLEAR_R to RIPPLE_MAX_R: ramp from 0 up to RIPPLE_TARGET_MAX
    var outerFrac = (dist - RIPPLE_CLEAR_R) / (RIPPLE_MAX_R - RIPPLE_CLEAR_R);
    outerFrac = Math.min(1, Math.max(0, outerFrac));
    var targetAlpha = RIPPLE_TARGET_MAX * outerFrac;
    return { mode: 'lighten', targetAlpha: targetAlpha };
  }

  var pixels = [];
  var grid = [];
  var columns = [];

  function initGrid() {
    cols = Math.ceil(w / CELL);
    rows = Math.ceil(h / CELL);

    // build pixels
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

    // grid lookup
    grid = new Array(cols * rows);
    pixels.forEach(function(p) { grid[p.x * rows + p.y] = p; });

    // columns: stratified random vertical distribution for even coverage without large gaps
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
      var temp = positions[i];
      positions[i] = positions[j];
      positions[j] = temp;
    }

    for (var x = 0; x < cols; x++) {
      var colY = positions[x];
      columns.push({ y: colY, speed: randSpeed() });

      // pre-seed trail pixels so the column appears filled on load where applicable
      var baseX = x;
      for (var k = 0; k < TRAIL_LEN; k++) {
        var gy = Math.floor(colY) - k;
        if (gy < 0 || gy >= rows) continue;
        var p = grid[baseX * rows + gy];
        if (!p) continue;
        p.seededDark = randAmbient();
        p.seededArmed = true;
        p.flashAlpha = LEAD_DARK;
        p.rippleAlpha = 0;
        p.state = 'flashing';
      }
    }
  }

  var mouseX = -1000, mouseY = -1000;
  canvasEl.addEventListener('mousemove', function(e) {
    var r = canvasEl.getBoundingClientRect();
    mouseX = e.clientX - r.left; mouseY = e.clientY - r.top;
  });
  canvasEl.addEventListener('mouseleave', function() { mouseX = -1000; mouseY = -1000; });
  canvasEl.addEventListener('touchmove', function(e) {
    e.preventDefault();
    var r = canvasEl.getBoundingClientRect();
    mouseX = e.touches[0].clientX - r.left; mouseY = e.touches[0].clientY - r.top;
  }, { passive: false });
  canvasEl.addEventListener('touchend', function() { mouseX = -1000; mouseY = -1000; });

  var ripples = [];
  function addRipple(rx, ry) {
    ripples.push({ x: rx, y: ry, lastR: 0, born: performance.now() });
    if (ripples.length > 5) ripples.shift();
  }
  canvasEl.addEventListener('click', function(e) {
    var r = canvasEl.getBoundingClientRect();
    addRipple(e.clientX - r.left, e.clientY - r.top);
  });
  canvasEl.addEventListener('touchstart', function(e) {
    var r = canvasEl.getBoundingClientRect();
    addRipple(e.touches[0].clientX - r.left, e.touches[0].clientY - r.top);
  });

  function applyRipples(now, t) {
    var i = ripples.length;
    while (i--) {
      var rp = ripples[i];
      var age = now - rp.born;
      if (age > RIPPLE_LIFE) { ripples.splice(i, 1); continue; }

      var progress = age / RIPPLE_LIFE;
      var waveR = RIPPLE_MAX_R * easeOut(progress);
      var rMin = rp.lastR, rMax = waveR;
      rp.lastR = waveR;
      if (rMax - rMin < 0.3) continue;

      // bounding box around annulus only
      var outerR = rMax + CELL;
      var xMinC = Math.max(0, Math.floor((rp.x - outerR) / CELL));
      var xMaxC = Math.min(cols - 1, Math.ceil((rp.x + outerR) / CELL));
      var yMinC = Math.max(0, Math.floor((rp.y - outerR) / CELL));
      var yMaxC = Math.min(rows - 1, Math.ceil((rp.y + outerR) / CELL));

      for (var cx = xMinC; cx <= xMaxC; cx++) {
        for (var cy = yMinC; cy <= yMaxC; cy++) {
          var px = cx * CELL + CELL / 2, py = cy * CELL + CELL / 2;
          var dx = px - rp.x, dy = py - rp.y;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < rMin || dist > rMax) continue;
          var p = grid[cx * rows + cy];
          if (!p || p.state === 'flashing') continue;

          var target = rippleTarget(dist);
          var curDark = currentDarkness(p, t);

          if (target.mode === 'clear') {
            // always clear inner zone regardless of current brightness
            p.state = 'cleared';
            p.seededArmed = false;
            p.rippleAlpha = 0;
          } else {
            // only apply if pixel is currently darker than target
            if (curDark > target.targetAlpha) {
              p.rippleAlpha = target.targetAlpha;
              p.state = target.targetAlpha <= 0 ? 'cleared' : 'tinted';
              p.seededArmed = false;
            }
            // if already lighter than target, leave it alone
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
        p.seededDark = randAmbient();
        p.seededArmed = true;
        p.flashAlpha = LEAD_DARK;
        p.rippleAlpha = 0;
        p.state = 'flashing';
      }
    }
  }

  function clearNearMouse() {
    if (mouseX < 0 || mouseX > w || mouseY < 0 || mouseY > h) return;
    var cx = Math.floor(mouseX / CELL), cy = Math.floor(mouseY / CELL);
    for (var dx = -1; dx <= 1; dx++) {
      for (var dy = -1; dy <= 1; dy++) {
        if (Math.abs(dx) + Math.abs(dy) > 1) continue;
        var gx = cx + dx, gy = cy + dy;
        if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) continue;
        var p = grid[gx * rows + gy];
        if (p && p.state !== 'flashing') { p.state = 'cleared'; p.seededArmed = false; p.rippleAlpha = 0; }
      }
    }
  }

  // Snap the ::before panel edges to the pixel-column grid (CELL=8px) so
  // hard panel edges always land in the 1px gap between columns.
  // Uses a <style> tag injection so the values are exact pixels with no
  // CSS-variable inheritance or relative-offset ambiguity.
  // Column indices where the stepped fade begins on each side.
  // Set by alignPanels(), read by draw().
  var fadeEdgeL = -1, fadeEdgeR = -1;

  var panelStyle = null;
  function alignPanels() {
    var content = document.querySelector('.page-content');
    if (!content) return;
    var r = content.getBoundingClientRect();
    fadeEdgeL = Math.floor(r.left  / CELL);  // first column index at/past left edge
    fadeEdgeR = Math.ceil(r.right / CELL);   // first column index at/past right edge
    var targetL = fadeEdgeL * CELL - 3.5;
    var targetR = fadeEdgeR * CELL + 4;
    // Offsets are relative to each element's own containing block.
    // .page-content::before: containing block = .page-content (left edge = r.left)
    var cLeft  = targetL - r.left;   // negative = extends left of content
    var cRight = r.right - targetR;  // negative = extends right of content
    // .page-footer::before: containing block = .page-footer (full viewport width, left edge ≈ 0)
    var footer = document.querySelector('.page-footer');
    var fLeft = targetL;
    var fRight = footer ? (footer.getBoundingClientRect().right - targetR) : cRight;
    if (!panelStyle) {
      panelStyle = document.createElement('style');
      document.head.appendChild(panelStyle);
    }
    panelStyle.textContent =
      '.page-content::before{left:' + cLeft  + 'px!important;right:' + cRight + 'px!important}' +
      '.page-footer::before{left:'  + fLeft  + 'px!important;right:' + fRight + 'px!important}';
  }

  if (window.ResizeObserver) {
    var _content = document.querySelector('.page-content');
    if (_content) new ResizeObserver(function() { requestAnimationFrame(alignPanels); }).observe(_content);
  }

  var paused = false;
  document.addEventListener('visibilitychange', function() { paused = document.hidden; });
  var observer = new IntersectionObserver(function(entries) { paused = !entries[0].isIntersecting; }, { threshold: 0.01 });
  observer.observe(canvasEl);
  var resizeTimer = null;

  function draw(t, now, dt) {
    advanceColumns(dt);
    applyRipples(now, t);
    clearNearMouse();

    ctx.fillStyle = '#f5f4f0';
    ctx.fillRect(0, 0, w, h);

    for (var i = 0; i < pixels.length; i++) {
      var p = pixels[i];
      var px = p.x * CELL, py = p.y * CELL;

      if (p.state === 'cleared') continue;

      if (p.state === 'flashing') {
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
        ctx.fillStyle = fillColor(p.rippleAlpha);
        ctx.fillRect(px, py, CELL - 1, CELL - 1);
        continue;
      }

      // ambient
      var wave = 0.5 + 0.5 * Math.sin(t * p.speed + p.phase);
      var darkness = p.ambMin + (p.ambMax - p.ambMin) * wave;
      ctx.fillStyle = fillColor(darkness);
      ctx.fillRect(px, py, CELL - 1, CELL - 1);
    }

    // column streaks
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

    // Stepped column fade at panel edges — 3 columns per side, each a uniform
    // opacity overlay of the background color (outermost = most transparent).
    if (fadeEdgeL >= 0 && fadeEdgeR >= 0) {
      // var fadeAlphas = [0.3, 0.55, 0.8,]; // outer → inner
      var fadeAlphas = [0.2, 0.4, 0.6, 0.8]; // outer → inner
      ctx.fillStyle = '#f5f4f0';
      for (var fi = 0; fi < fadeAlphas.length; fi++) {
        ctx.globalAlpha = fadeAlphas[fi];
        ctx.fillRect((fadeEdgeL - fadeAlphas.length + fi) * CELL, 0, CELL, h); // left side
        ctx.fillRect((fadeEdgeR + fadeAlphas.length + 1 - fi) * CELL, 0, CELL, h); // right side
      }
      ctx.globalAlpha = 1;
    }
  }

  var start = null, lastT = 0;
  function frame(ts) {
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
    // update target sizes immediately, but debounce reinitialization to avoid visual spazz
    w = window.innerWidth;
    h = window.innerHeight;
    // pause animation while resizing for smoother result
    paused = true;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
      dpr = window.devicePixelRatio || 1;
      canvasEl.width = w * dpr;
      canvasEl.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initGrid();
      alignPanels();
      paused = false;
    }, 150);
  });

  window.addEventListener('load', alignPanels);

  // initialize grid and start animation
  initGrid();
  alignPanels();
  requestAnimationFrame(frame);
})();
