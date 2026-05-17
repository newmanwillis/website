(function () {
  var canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');

  // Offscreen canvas: each ribbon is drawn here first, then composited
  // onto the main canvas with a blur — merging all strands into one soft band.
  var offscreen = document.createElement('canvas');
  var offCtx    = offscreen.getContext('2d');

  var SEGS         = 26;
  var DESIGN_W     = 1440;
  var DESIGN_H     = 900;
  var RIBBON_COUNT = 8;
  var HALF_STRANDS = 5;   // strands on each side + center = 11 per ribbon
  var t = 0;
  var w, h, scale;
  var tIncrement   = 0.009;
  var HOME_SPEED    = 0.009;
  var PROJECT_SPEED = 0.002;

  var ribbons = [];
  for (var r = 0; r < RIBBON_COUNT; r++) {
    var peakAlpha = 0.09 //+ Math.random() * 0.08;
    var spread    = 20 + Math.random() * 18;
    // Golden-brown tones with slight variation between ribbons
    var hue  = Math.random();
    var ribbon = {
      cr: Math.floor(95 + hue * 40),
      cg: Math.floor(58 + hue * 28),
      cb: Math.floor(8  + hue * 12),
      baseY: (r + 0.5) / RIBBON_COUNT,
      amp1:  28 + Math.random() * 28,
      wl1:   0.5 + Math.random() * 0.65,
      ph1:   Math.random() * Math.PI * 2,
      sp1:   0.0005 + Math.random() * 0.0004,
      // Slow drift — very long wavelength so only a fraction of the cycle
      // is visible, creating a gradual slope from one side to the other
      ampD:  55 + Math.random() * 60,
      wlD:   2.0 + Math.random() * 2.0,
      phD:   Math.random() * Math.PI * 2,
      spD:   0.00015 + Math.random() * 0.00015,
      strands: [],
    };

    for (var s = -HALF_STRANDS; s <= HALF_STRANDS; s++) {
      var frac = Math.abs(s) / HALF_STRANDS;
      ribbon.strands.push({
        offset: s * spread / HALF_STRANDS,
        amp2: 8 + Math.random() * 9,
        wl2:  0.1  + Math.random() * 0.12,
        ph2:  Math.random() * Math.PI * 2,
        sp2:  0.0009 + Math.random() * 0.001,
        amp3: 5 + Math.random() * 7,
        wl3:  0.055 + Math.random() * 0.045,
        ph3:  Math.random() * Math.PI * 2,
        sp3:  0.0016 + Math.random() * 0.0013,
        alpha: peakAlpha * (1.0 - frac * 0.75),
        lw:    5.0 - frac * 3.0,
      });
    }

    ribbons.push(ribbon);
  }

  function resize() {
    w = canvas.width = offscreen.width  = window.innerWidth;
    h = canvas.height = offscreen.height = window.innerHeight;
    scale = Math.max(w / DESIGN_W, h / DESIGN_H, 1);
  }

  function drawStrandTo(c, ribbon, strand, tEff) {
    var step = DESIGN_W / SEGS;
    function yAt(x) {
      return ribbon.baseY * DESIGN_H + strand.offset
        + Math.sin(x / (DESIGN_W * ribbon.wlD) * Math.PI * 4 + ribbon.phD + tEff * ribbon.spD) * ribbon.ampD
        + Math.sin(x / (DESIGN_W * ribbon.wl1) * Math.PI * 4 + ribbon.ph1 + tEff * ribbon.sp1) * ribbon.amp1
        + Math.sin(x / (DESIGN_W * strand.wl2) * Math.PI * 4 + strand.ph2 + tEff * strand.sp2) * strand.amp2
        + Math.sin(x / (DESIGN_W * strand.wl3) * Math.PI * 4 + strand.ph3 + tEff * strand.sp3) * strand.amp3;
    }
    c.beginPath();
    var x0 = -step, x1 = 0;
    c.moveTo((x0 + x1) / 2, (yAt(x0) + yAt(x1)) / 2);
    for (var i = 0; i <= SEGS + 1; i++) {
      var cx = i * step, nx = (i + 1) * step;
      c.quadraticCurveTo(cx, yAt(cx), (cx + nx) / 2, (yAt(cx) + yAt(nx)) / 2);
    }
    c.strokeStyle = 'rgba(' + ribbon.cr + ',' + ribbon.cg + ',' + ribbon.cb + ',' + strand.alpha.toFixed(3) + ')';
    c.lineWidth   = strand.lw / scale;
    c.stroke();
  }

  function drawRibbonSoft(ribbon, tEff) {
    offCtx.save();
    offCtx.translate((w - DESIGN_W * scale) / 2, (h - DESIGN_H * scale) / 2);
    offCtx.scale(scale, scale);
    offCtx.lineCap  = 'round';
    offCtx.lineJoin = 'round';
    for (var s = 0; s < ribbon.strands.length; s++) {
      drawStrandTo(offCtx, ribbon, ribbon.strands[s], tEff);
    }
    offCtx.restore();
  }

  function drawRibbonHard(ribbon, tEff) {
    ctx.save();
    ctx.translate((w - DESIGN_W * scale) / 2, (h - DESIGN_H * scale) / 2);
    ctx.scale(scale, scale);
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';
    for (var s = 0; s < ribbon.strands.length; s++) {
      var strand = ribbon.strands[s];
      var hardStrand = {
        offset: strand.offset,
        amp2: strand.amp2, wl2: strand.wl2, ph2: strand.ph2, sp2: strand.sp2,
        amp3: strand.amp3, wl3: strand.wl3, ph3: strand.ph3, sp3: strand.sp3,
        alpha: strand.alpha * 0.2,
        lw:    strand.lw * 0.4,
      };
      drawStrandTo(ctx, ribbon, hardStrand, tEff);
    }
    ctx.restore();
  }

  function animate() {
    var onProject = location.pathname.indexOf('/projects/') !== -1;
    var target = onProject ? PROJECT_SPEED : HOME_SPEED;
    tIncrement += (target - tIncrement) * 0.02;

    ctx.clearRect(0, 0, w, h);
    var tEff = t * 800;

    // Pass 1 — all ribbons to offscreen, single blur composite
    offCtx.clearRect(0, 0, w, h);
    for (var r = 0; r < ribbons.length; r++) {
      drawRibbonSoft(ribbons[r], tEff);
    }
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.filter = 'blur(6px)';
    ctx.drawImage(offscreen, 0, 0);
    ctx.filter = 'none';
    ctx.restore();

    // Pass 2 — hard lines for all ribbons directly on main canvas
    for (var r = 0; r < ribbons.length; r++) {
      drawRibbonHard(ribbons[r], tEff);
    }

    t += tIncrement;
    requestAnimationFrame(animate);
  }

  window.addEventListener('resize', resize);
  resize();
  if (!window.matchMedia('(pointer: coarse)').matches) {
    animate();
  }
})();
