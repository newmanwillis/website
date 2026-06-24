(function () {
  var projects = [
    { title: 'Google Robotics UI', file: 'robotics-ui.html' },
    { title: 'Sturfee AR Projects', file: 'sturfee.html' },
    { title: 'Breach',             file: 'breach.html' },
    { title: 'Rainbow Blues Cat',  file: 'rainbow-blues-cat.html' },
    { title: 'Oculus Escape',       file: 'oculus-escape.html' },
    { title: 'Dead Week',          file: 'dead-week.html' },
    { title: 'The Lost Files',    file: 'the-lost-files.html' },
  ];

  // Derive site root from this script's URL so links work from any page depth
  var siteRoot = (function () {
    var s = document.currentScript;
    if (!s) return '/';
    return new URL(s.src).pathname.replace(/js\/nav\.js$/, '');
  }());

  function currentFile() {
    return window.location.pathname.split('/').pop();
  }

  function isProjectPage() {
    var cf = currentFile();
    return projects.some(function (p) { return p.file === cf; });
  }

  function buildMenuItems() {
    var cf = currentFile();
    return projects.map(function (p) {
      if (p.file === cf) {
        return '<li><span class="current">' + p.title + '</span></li>';
      }
      return '<li><a href="' + siteRoot + 'projects/' + p.file + '">' + p.title + '</a></li>';
    }).join('');
  }

  /* ── BACK BAR (left side fixed buttons) — commented out, replaced by top nav ──

  var bar = document.createElement('div');
  bar.className = 'back-bar';
  document.body.appendChild(bar);

  bar.innerHTML =
    '<div class="nav-btn-group">' +
      '<a class="nav-btn" href="' + siteRoot + 'index.html" aria-label="Home">' +
        '<svg viewBox="0 0 24 24"><path d="M12 2L1 10L4 10L4 21L9 21L9 15L15 15L15 21L20 21L20 10L23 10Z"/></svg>' +
      '</a>' +
      '<button class="nav-btn" id="nav-menu-btn" aria-label="Project menu" aria-expanded="false">' +
        '<svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>' +
      '</button>' +
    '</div>' +
    '<div class="project-nav-menu" id="project-nav-menu" hidden>' +
      '<ul>' + buildMenuItems() + '</ul>' +
    '</div>';

  var btn = document.getElementById('nav-menu-btn');
  var menu = document.getElementById('project-nav-menu');

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    var isOpen = !menu.hidden;
    menu.hidden = isOpen;
    btn.setAttribute('aria-expanded', String(!isOpen));
  });

  document.addEventListener('click', function (e) {
    if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !menu.hidden) {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      btn.focus();
    }
  });

  var spacerEl = document.createElement('div');
  spacerEl.className = 'back-spacer';
  var sc = document.getElementById('site-content');
  if (sc) sc.parentNode.insertBefore(spacerEl, sc);

  function checkScroll() {
    if (window.innerWidth <= 1150) {
      var threshold = spacerEl.offsetHeight || 48;
      bar.classList.toggle('scrolled-past', window.scrollY > threshold);
    } else {
      bar.classList.remove('scrolled-past');
    }
  }
  window.addEventListener('scroll', checkScroll, { passive: true });
  window.addEventListener('resize', checkScroll);

  ── END BACK BAR ── */

  // ── TOP NAV ──
  function injectTopNav() {
    if (!isProjectPage()) return;
    var pc = document.querySelector('.page-content');
    if (!pc || pc.querySelector('.page-topnav')) return;

    var topNav = document.createElement('div');
    topNav.className = 'page-topnav';
    topNav.innerHTML =
      '<div class="topnav-left">' +
        '<a class="topnav-home" href="' + siteRoot + 'index.html">Home</a>' +
        '<div class="topnav-right">' +
          '<button class="topnav-projects-btn" aria-expanded="false">Projects <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></button>' +
          '<div class="topnav-menu" hidden><ul>' + buildMenuItems() + '</ul></div>' +
        '</div>' +
      '</div>';

    pc.insertBefore(topNav, pc.firstChild);

    var projBtn = topNav.querySelector('.topnav-projects-btn');
    var menuEl  = topNav.querySelector('.topnav-menu');

    projBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = !menuEl.hidden;
      menuEl.hidden = isOpen;
      projBtn.setAttribute('aria-expanded', String(!isOpen));
    });

    // Close when mouse leaves both the button and the menu
    var closeTimer = null;
    function scheduleClose() {
      closeTimer = setTimeout(function () {
        menuEl.hidden = true;
        projBtn.setAttribute('aria-expanded', 'false');
      }, 80);
    }
    function cancelClose() {
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    }
    projBtn.addEventListener('mouseleave', scheduleClose);
    projBtn.addEventListener('mouseenter', cancelClose);
    menuEl.addEventListener('mouseleave', scheduleClose);
    menuEl.addEventListener('mouseenter', cancelClose);
  }

  // Close topnav dropdown on outside click or Escape (single persistent handlers)
  document.addEventListener('click', function (e) {
    var menuEl = document.querySelector('.topnav-menu');
    var btnEl  = document.querySelector('.topnav-projects-btn');
    if (!menuEl || menuEl.hidden) return;
    if (!menuEl.contains(e.target) && (!btnEl || !btnEl.contains(e.target))) {
      menuEl.hidden = true;
      if (btnEl) btnEl.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var menuEl = document.querySelector('.topnav-menu');
    var btnEl  = document.querySelector('.topnav-projects-btn');
    if (!menuEl || menuEl.hidden) return;
    menuEl.hidden = true;
    if (btnEl) { btnEl.setAttribute('aria-expanded', 'false'); btnEl.focus(); }
  });

  function updateNav() {
    document.body.classList.toggle('project-page', isProjectPage());
    injectTopNav();
  }

  updateNav();

  window.addEventListener('navchange', updateNav);
})();
