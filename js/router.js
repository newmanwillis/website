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

    window.dispatchEvent(new CustomEvent('navstart'));
    el.style.transition = 'opacity 0.18s ease';
    el.style.opacity = '0';
    await new Promise(function (r) { setTimeout(r, 180); });

    // Update the document URL BEFORE injecting the new markup. Relative
    // URLs inside it (card thumbnails, links) are resolved against the
    // document's URL at the moment the elements are parsed in, so if the
    // URL still pointed at the page we're leaving, a homepage thumbnail
    // like "images/foo.jpg" would resolve to "/projects/images/foo.jpg".
    // Firefox fetches images eagerly during parsing and 404s on that;
    // Chrome happens to defer the fetch until after the URL changes, which
    // masked the bug. (popstate navigations pass pushState=false — the
    // browser has already updated the URL by the time we run.)
    if (pushState) history.pushState({ url: url }, doc.title, url);

    el.innerHTML = newContent.innerHTML;
    document.title = doc.title;
    window.scrollTo(0, 0);
    runScripts(el);

    el.style.opacity = '1';
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
