(function () {
  var projects = [
    { title: 'Google Robotics UI', file: 'robotics-ui.html' },
    { title: 'Sturfee AR Projects', file: 'sturfee.html' },
    { title: 'Breach',             file: 'breach.html' },
    { title: 'Rainbow Blues Cat',  file: 'rainbow-blues-cat.html' },
    { title: 'Bursting Brains',    file: 'bursting-brains.html' },
    { title: 'Dead Week',          file: 'dead-week.html' },
    { title: 'Miscellaneous',      file: 'miscellaneous.html' },
  ];

  var currentFile = window.location.pathname.split('/').pop();

  var menuItems = projects.map(function (p) {
    if (p.file === currentFile) {
      return '<li><span class="current">' + p.title + '</span></li>';
    }
    return '<li><a href="' + p.file + '">' + p.title + '</a></li>';
  }).join('');

  var bar = document.querySelector('.back-bar');
  if (!bar) return;

  bar.innerHTML =
    '<div class="nav-btn-group">' +
      '<button class="nav-btn" id="nav-menu-btn" aria-label="Project menu" aria-expanded="false">' +
        '<svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>' +
      '</button>' +
      '<a class="nav-btn" href="../index.html" aria-label="Home">' +
        '<svg viewBox="0 0 24 24"><path d="M12 2L1 10L4 10L4 21L9 21L9 15L15 15L15 21L20 21L20 10L23 10Z"/></svg>' +
      '</a>' +
    '</div>' +
    '<div class="project-nav-menu" id="project-nav-menu" hidden>' +
      '<ul>' + menuItems + '</ul>' +
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

  // Narrow-screen scroll fade
  var spacer = document.querySelector('.back-spacer');
  function checkScroll() {
    if (window.innerWidth <= 1150) {
      var threshold = spacer ? spacer.offsetHeight : 48;
      bar.classList.toggle('scrolled-past', window.scrollY > threshold);
    } else {
      bar.classList.remove('scrolled-past');
    }
  }
  window.addEventListener('scroll', checkScroll, { passive: true });
  window.addEventListener('resize', checkScroll);
  checkScroll();

  // Update current-page highlight after client-side navigation
  window.addEventListener('navchange', function () {
    var cf = window.location.pathname.split('/').pop();
    menu.querySelectorAll('li').forEach(function (li, i) {
      var p = projects[i];
      if (!p) return;
      li.innerHTML = p.file === cf
        ? '<span class="current">' + p.title + '</span>'
        : '<a href="' + p.file + '">' + p.title + '</a>';
    });
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    checkScroll();
  });
})();
