// Modify view: on supported sites that are on the user's list, injects the CSS
// of the enabled adapter options. Runs at document_start; adapters.js loads first.
(function () {
  const api = globalThis.browser ?? globalThis.chrome;
  const host = location.hostname.replace(/^www\./, '');
  const covers = (domain) => host === domain || host.endsWith('.' + domain);
  const adapter = (globalThis.ClearMindAdapters ?? []).find((a) => a.domains.some(covers));
  if (!adapter) return;

  const GRAYSCALE = 'img, video, picture, canvas, svg image { filter: grayscale(1) !important; }';
  const style = document.createElement('style');
  style.id = 'clearmind-modify';
  let enabled = [];
  let lastUrl = '';

  // The configured site entry for this host: the most specific domain wins.
  function siteFor(sites) {
    const matches = Object.keys(sites ?? {}).filter(covers).sort((a, b) => b.length - a.length);
    return matches.length ? sites[matches[0]] : null;
  }

  function apply(site) {
    if (!site) {
      enabled = [];
      style.remove();
      return;
    }
    enabled = adapter.options.filter((o) => site.modify?.[o.key] ?? o.default);
    const css = enabled.map((o) => o.css);
    if (site.modify?.grayscale) css.push(GRAYSCALE);
    style.textContent = css.join('\n');
    if (!style.isConnected) (document.head ?? document.documentElement).append(style);
    onUrl(true);
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
    document.documentElement.dataset.cmRoute = adapter.route(url);
    if (enabled.some((o) => o.redirect)) {
      const target = adapter.redirect(url);
      if (target && target !== location.href) location.replace(target);
    }
  }

  api.storage.local.get('sites').then(({ sites }) => apply(siteFor(sites)));
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.sites) apply(siteFor(changes.sites.newValue));
  });

  // SPAs change the URL without a page load; a cheap poll catches every router.
  setInterval(onUrl, 400);
  // The <head> may be replaced while the page boots; keep the style attached.
  document.addEventListener('DOMContentLoaded', () => {
    if (style.textContent && !style.isConnected) document.head.append(style);
  });
})();
