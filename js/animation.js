(function () {
  var canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var LINE_COUNT = 14;
  var SEGS = 8;
  var DESIGN_W = 1440;
  var DESIGN_H = 900;
  var t = 0;
  var w, h, scale;
  var tIncrement = 0.009;
  var HOME_SPEED    = 0.009;
  var PROJECT_SPEED = 0.002;

  var lines = Array.from({ length: LINE_COUNT }, function (_, i) {
    return {
      baseY: i / (LINE_COUNT - 1),
      amp:   45 + Math.random() * 55,
      speed: 0.0004 + Math.random() * 0.0005,
      phase: Math.random() * Math.PI * 2,
      wl:    0.6 + Math.random() * 0.8,
      alpha: 0.07 + Math.random() * 0.06,
    };
  });

  function resize() {
    w = canvas.width  = window.innerWidth;
    h = canvas.height = window.innerHeight;
    // Never scale below 1× — smaller viewports crop into the design rather than zooming out
    scale = Math.max(w / DESIGN_W, h / DESIGN_H, 1);
  }

  function drawLine(line, time) {
    var baseY = line.baseY * DESIGN_H;
    var step  = DESIGN_W / SEGS;

    ctx.beginPath();
    ctx.moveTo(-step, baseY + Math.sin(line.phase + time) * line.amp);

    for (var s = 0; s <= SEGS + 1; s++) {
      var x  = s * step;
      var y  = baseY + Math.sin(x  / (DESIGN_W * line.wl) * Math.PI * 4 + line.phase + time) * line.amp;
      var nx = (s + 1) * step;
      var ny = baseY + Math.sin(nx / (DESIGN_W * line.wl) * Math.PI * 4 + line.phase + time) * line.amp;
      ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
    }

    ctx.strokeStyle = 'rgba(15,14,12,' + line.alpha.toFixed(3) + ')';
    ctx.lineWidth = 1.2 / scale; // compensate so stroke weight stays visually consistent
    ctx.stroke();
  }

  function animate() {
    var onProject = location.pathname.indexOf('/projects/') !== -1;
    var target = onProject ? PROJECT_SPEED : HOME_SPEED;
    tIncrement += (target - tIncrement) * 0.02;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    // Center the design canvas and scale to cover the viewport
    ctx.translate((w - DESIGN_W * scale) / 2, (h - DESIGN_H * scale) / 2);
    ctx.scale(scale, scale);
    for (var i = 0; i < lines.length; i++) {
      drawLine(lines[i], t * lines[i].speed * 800);
    }
    ctx.restore();

    t += tIncrement;
    requestAnimationFrame(animate);
  }

  window.addEventListener('resize', resize);
  resize();
  // Checks if finger is primary input (Meant to disable animation on mobile)
  if (!window.matchMedia('(pointer: coarse)').matches) {
    animate();
  }
})();
