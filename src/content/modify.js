// Modify view: on supported sites that are on the user's list, injects the CSS
// of the enabled adapter options. Runs at document_start; adapters.js loads first.
(function () {
  const api = globalThis.browser ?? globalThis.chrome;
  const host = location.hostname.replace(/^www\./, '');
  const covers = (domain) => host === domain || host.endsWith('.' + domain);
  const adapter = (globalThis.ClearMindAdapters ?? []).find((a) => a.domains.some(covers));
  if (!adapter) return;

  const GRAYSCALE = 'img, video, picture, canvas, svg image { filter: grayscale(1) !important; }';
  // Parts of the previous page that stay hidden while a single-page app swaps
  // in the next one (see holdHidden).
  const HIDE = 'data-cm-hide';
  const HOLD_CSS = `[${HIDE}] { display: none !important; }`;
  const style = document.createElement('style');
  style.id = 'clearmind-modify';
  let enabled = [];
  let hideSelectors = [];
  let lastUrl = '';

  // The configured site entry for this host: the most specific domain wins.
  function siteFor(sites) {
    const matches = Object.keys(sites ?? {}).filter(covers).sort((a, b) => b.length - a.length);
    return matches.length ? sites[matches[0]] : null;
  }

  // Selectors of the `display: none` rules in `css` (pseudo-elements skipped;
  // commas inside :is(...) are not separators).
  function hiddenSelectors(css) {
    const selectors = [];
    for (const [, list, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/display\s*:\s*none/.test(body)) continue;
      for (const part of list.split(/,(?![^()]*\))/)) {
        const selector = part.trim();
        if (selector && !selector.includes('::')) selectors.push(selector);
      }
    }
    return selectors;
  }

  function apply(site) {
    release();
    if (!site) {
      enabled = [];
      hideSelectors = [];
      style.remove();
      return;
    }
    enabled = adapter.options.filter((o) => site.modify?.[o.key] ?? o.default);
    const css = enabled.map((o) => o.css);
    hideSelectors = hiddenSelectors(css.join('\n'));
    if (site.modify?.grayscale) css.push(GRAYSCALE);
    css.push(HOLD_CSS);
    style.textContent = css.join('\n');
    if (!style.isConnected) (document.head ?? document.documentElement).append(style);
    onUrl(true);
  }

  // Single-page apps (reddit, YouTube, X…) change the URL first and swap the
  // content later. The route-scoped CSS would stop matching the old page's feed
  // for that moment, so before the route changes everything currently hidden
  // is marked to stay hidden. A marked element is released when it is filled
  // with new content (the app reused it for the next page) or on the next
  // navigation; an element the app removes simply goes away.
  const held = new Set();
  let watcher = null;
  // Set when the Navigation API already marked the old page for this navigation.
  let heldEarly = false;

  function release() {
    watcher?.disconnect();
    watcher = null;
    for (const el of held) el.removeAttribute(HIDE);
    held.clear();
  }

  function holdHidden() {
    release();
    for (const selector of hideSelectors) {
      let found;
      try {
        found = document.querySelectorAll(selector);
      } catch {
        continue;
      }
      for (const el of found) {
        el.setAttribute(HIDE, '');
        held.add(el);
      }
    }
    if (!held.size) return;
    watcher = new MutationObserver((records) => {
      for (const { target } of records) {
        if (held.delete(target)) target.removeAttribute(HIDE);
      }
    });
    for (const el of held) watcher.observe(el, { childList: true });
  }

  // Tags <html> with the current route and follows redirect options (e.g. Shorts → watch).
  function onUrl(force) {
    if (!force && location.href === lastUrl) return;
    lastUrl = location.href;
    let url;
    try {
      url = new URL(location.href);
    } catch {
      return;
    }
    const route = adapter.route(url);
    if (!force && !heldEarly && route !== document.documentElement.dataset.cmRoute) holdHidden();
    heldEarly = false;
    document.documentElement.dataset.cmRoute = route;
    if (enabled.some((o) => o.redirect)) {
      const target = adapter.redirect(url);
      if (target && target !== location.href) location.replace(target);
    }
  }

  api.storage.local.get('sites').then(({ sites }) => apply(siteFor(sites)));
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.sites) apply(siteFor(changes.sites.newValue));
  });

  // The Navigation API reports a same-page navigation before the URL changes,
  // while the old content and route are still in place; the poll covers
  // browsers without it and anything it misses.
  globalThis.navigation?.addEventListener('navigate', (event) => {
    if (event.hashChange || event.downloadRequest) return;
    holdHidden();
    heldEarly = true;
  });
  addEventListener('popstate', () => onUrl());
  setInterval(onUrl, 150);
  // The <head> may be replaced while the page boots; keep the style attached.
  document.addEventListener('DOMContentLoaded', () => {
    if (style.textContent && !style.isConnected) document.head.append(style);
  });
})();
