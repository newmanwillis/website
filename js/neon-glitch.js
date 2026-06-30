(function () {
  var ENABLED = false; // set to true to enable the neon glitch effect

  var h1El   = null;
  var timer  = null;
  var active = false;

  var BRIGHT =
    '0 0 8px #fff,' +
    '0 0 20px #fff,' +
    '0 0 50px #fff,' +
    '0 0 100px rgba(255,255,255,0.95),' +
    '0 0 180px rgba(255,255,255,0.85),' +
    '0 0 300px rgba(255,255,255,0.6)';

  function apply(state) {
    if (!h1El) return;
    if (state === 'normal') {
      h1El.style.transition = '';
      h1El.style.textShadow = '';
    } else if (state === 'bright') {
      h1El.style.textShadow = BRIGHT;
    } else if (state === 'off') {
      h1El.style.textShadow = 'none';
    }
  }

  function runSteps(steps, i) {
    if (!active || !h1El || i >= steps.length) {
      apply('normal');
      scheduleNext();
      return;
    }
    apply(steps[i].state);
    timer = setTimeout(function () { runSteps(steps, i + 1); }, steps[i].ms);
  }

  function glitch() {
    if (!h1El) return;
    h1El.style.transition = 'text-shadow 1s ease';
    apply('bright');

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

      // runSteps returns to normal and reschedules after the last step
      runSteps(steps, 0);
    }, 1000);
  }

  function scheduleNext() {
    if (!active) return;
    timer = setTimeout(glitch, 4000 + Math.random() * 8000);
  }

  function start() {
    h1El = document.querySelector('.intro-cover header h1');
    if (!h1El) return;
    active = true;
    scheduleNext();
  }

  function stop() {
    active = false;
    if (timer) { clearTimeout(timer); timer = null; }
    if (h1El) apply('normal');
    h1El = null;
  }

  if (ENABLED) start();
  window.addEventListener('navchange', function () { stop(); if (ENABLED) start(); });
})();
