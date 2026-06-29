(function () {
  var h1El = null;
  var timer = null;
  var active = false;

  var BRIGHT = '0 0 48px #f5f4f0, 0 0 96px #f5f4f0, 0 0 160px rgba(245,244,240,0.8), 0 0 220px rgba(245,244,240,0.4)';

  function apply(state) {
    if (!h1El) return;
    if (state === 'normal') {
      h1El.style.transition  = '';
      h1El.style.textShadow  = '';
      h1El.style.opacity     = '';
    } else if (state === 'bright') {
      h1El.style.textShadow  = BRIGHT;
      h1El.style.opacity     = '';
    } else if (state === 'off') {
      h1El.style.textShadow  = 'none';
      h1El.style.opacity     = '0.12';
    }
  }

  function runSteps(steps, i) {
    if (!active || !h1El || i >= steps.length) {
      apply('normal');
      scheduleNext();
      return;
    }
    var s = steps[i];
    apply(s.state);
    timer = setTimeout(function () { runSteps(steps, i + 1); }, s.ms);
  }

  function glitch() {
    if (!h1El) return;

    // Gradually build to full brightness over 1 second
    h1El.style.transition = 'text-shadow 1s ease';
    apply('bright');

    // Once the build-up completes, cut the transition and start glitching
    timer = setTimeout(function () {
      if (!active || !h1El) return;
      h1El.style.transition = 'none';

      var steps = [];

      // 1–3 flicker cycles
      var n = 1 + Math.floor(Math.random() * 3);
      for (var i = 0; i < n; i++) {
        steps.push({ state: 'off',    ms: 40  + Math.random() * 110 });
        steps.push({ state: 'bright', ms: 25  + Math.random() * 70  });
      }

      // Final cut-out
      steps.push({ state: 'off', ms: 55 + Math.random() * 90 });

      // Occasional extra stutter at the end
      if (Math.random() > 0.45) {
        steps.push({ state: 'bright', ms: 20 + Math.random() * 35 });
        steps.push({ state: 'off',    ms: 35 + Math.random() * 55 });
      }

      runSteps(steps, 0);
    }, 1000);
  }

  function scheduleNext() {
    if (!active) return;
    timer = setTimeout(glitch, 4000 + Math.random() * 8000);
  }

  function start() {
    h1El = document.querySelector('header h1');
    if (!h1El) return;
    active = true;
    scheduleNext();
  }

  function stop() {
    active = false;
    if (timer) { clearTimeout(timer); timer = null; }
    if (h1El) { apply('normal'); h1El = null; }
  }

  start();

  window.addEventListener('navchange', function () { stop(); start(); });
})();
