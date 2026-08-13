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

    // Start the request now, but don't wait on it yet: the outgoing half of
    // the transition doesn't depend on the response, and waiting first would
    // leave the click with no feedback at all until the network answers.
    var pending = fetch(url)
      .then(function (res) { return res.text(); })
      .then(function (html) { return new DOMParser().parseFromString(html, 'text/html'); });
    pending.catch(function () {});   // settled below; this just avoids a warning

    window.dispatchEvent(new CustomEvent('navstart'));

    // The project pages carry a solid centre panel (.page-content::before).
    // page-transition.js animates a stand-in for it so the panel can open and
    // close around the swap instead of blinking in and out with the content.
    var PT = window.PageTransition;
    var fromProject = !!el.querySelector('.page-content');
    // Decided from the URL rather than the response, so the animation can start
    // before the response exists. /projects/<name>.html is a project page.
    var toProject = /(^|\/)projects\/[^\/]+\.html?$/i.test(new URL(url, location.href).pathname);
    // Leaving a project: take the cover over BEFORE the content fades, so the
    // panel never flickers while the element that paints it is removed.
    if (PT && fromProject) PT.hold();

    el.style.transition = 'opacity 0.15s ease';
    el.style.opacity = '0';
    await new Promise(function (r) { setTimeout(r, 150); });

    // Opening a project: the panel grows while the response is still in
    // flight, so the wait happens behind a cover that is already on screen.
    if (PT && !fromProject && toProject) await PT.expand();

    var doc;
    try { doc = await pending; } catch (e) { location.href = url; return; }
    var newContent = doc.getElementById('site-content');
    if (!newContent) { location.href = url; return; }

    // Returning home: retract only once the homepage is ready, so the panel
    // never opens onto an empty background.
    if (PT && fromProject && !toProject) await PT.retract();

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

    el.style.transition = 'opacity 0.23s ease';
    el.style.opacity = '1';
    window.dispatchEvent(new CustomEvent('navchange'));

    // Hand back to the real panel only once the content covering it is opaque.
    if (PT && toProject) {
      await new Promise(function (r) { setTimeout(r, 270); });
      PT.hide();
    }
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
