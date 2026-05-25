(function () {
  function resolveUrl(href) {
    return new URL(href, location.href).href;
  }

  // Re-execute inline scripts in swapped content (innerHTML doesn't run scripts)
  function runScripts(el) {
    el.querySelectorAll('script').forEach(function (old) {
      var s = document.createElement('script');
      s.textContent = old.textContent;
      document.body.appendChild(s);
      s.remove();
    });
  }

  async function navigate(url, pushState) {
    var el = document.getElementById('site-content');
    if (!el) return;

    var html, doc;
    try {
      var res = await fetch(url);
      html = await res.text();
      doc = new DOMParser().parseFromString(html, 'text/html');
    } catch (e) {
      location.href = url;
      return;
    }

    var newContent = doc.getElementById('site-content');
    if (!newContent) { location.href = url; return; }

    el.style.transition = 'opacity 0.18s ease';
    el.style.opacity = '0';
    await new Promise(function (r) { setTimeout(r, 180); });

    el.innerHTML = newContent.innerHTML;
    document.title = doc.title;
    window.scrollTo(0, 0);
    runScripts(el);

    el.style.opacity = '1';
    if (pushState) history.pushState({ url: url }, doc.title, url);
    window.dispatchEvent(new CustomEvent('navchange'));
  }

  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href');
    if (!href ||
        href.startsWith('http') || href.startsWith('//') ||
        href.startsWith('#')    || href.startsWith('mailto:') ||
        href.startsWith('tel:') || link.target === '_blank') return;
    e.preventDefault();
    navigate(resolveUrl(href), true);
  });

  window.addEventListener('popstate', function (e) {
    if (e.state && e.state.url) navigate(e.state.url, false);
  });

  history.replaceState({ url: location.href }, document.title, location.href);
})();
