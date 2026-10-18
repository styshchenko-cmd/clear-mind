import { api } from '../lib/api.js';
import { ruleLabel } from '../lib/model.js';
import { formatClock, MINUTE } from '../lib/time.js';
import { bar, icon, optionsUrl, send, supportedAdapter, usageTone } from '../lib/ui.js';

const $ = (id) => document.getElementById(id);

const openOptions = (hash) => {
  api.tabs.create({ url: optionsUrl(hash) });
  window.close();
};

$('dashboard-icon').append(icon('grid', 18));
$('dashboard-icon').addEventListener('click', (e) => (e.preventDefault(), openOptions('stats')));
$('dashboard-link').addEventListener('click', (e) => (e.preventDefault(), openOptions('stats')));

// `?tab=<id>` renders the popup for a given tab (used when opening it as a page).
const forced = Number(new URLSearchParams(location.search).get('tab'));
const tab = forced ? { id: forced } : (await api.tabs.query({ active: true, currentWindow: true }))[0];
let state = await send('getPopupState', { tabId: tab.id });
let ticker = null;

function renderUsage(usedMs) {
  const site = state.site;
  $('usage').hidden = !site || site.mode === 'block';
  if ($('usage').hidden) return;
  $('used').textContent = formatClock(usedMs);
  const limited = site.mode === 'limit';
  $('left-row').hidden = !limited;
  $('usage-bar').replaceChildren();
  if (limited) {
    const limitMs = site.limitMin * MINUTE;
    const fraction = usedMs / limitMs;
    $('usage-bar').append(bar(fraction, usageTone(fraction) || 'amber', `${Math.floor(usedMs / MINUTE)} of ${site.limitMin} minutes used`));
    $('left').textContent = formatClock(limitMs - usedMs);
  }
}

function render() {
  clearInterval(ticker);
  $('error').textContent = '';
  if (!state.ok || !state.host) {
    $('site').textContent = '—';
    $('web').hidden = true;
    $('not-web').hidden = false;
    return;
  }
  const blocked = state.status === 'blocked';
  $('site').textContent = state.domain;
  $('web').hidden = false;
  $('not-web').hidden = true;
  $('status').textContent = blocked ? 'BLOCKED' : state.unlocked ? 'UNLOCKED' : 'ALLOWED';
  $('status').className = `strong ${blocked ? 'red' : state.unlocked ? 'amber' : 'green'}`;
  $('rule').textContent = state.site ? ruleLabel(state.site) : state.category ? state.category : 'none';

  renderUsage(state.usedMs);
  // Count up locally while the popup is open; the background keeps the real total.
  if (state.site && state.site.mode !== 'block' && !blocked) {
    const opened = Date.now();
    ticker = setInterval(() => renderUsage(state.usedMs + (Date.now() - opened)), 1000);
  }

  $('unblock').hidden = !blocked;
  $('block').hidden = blocked;
  const adapter = supportedAdapter(state.domain);
  $('modify').hidden = !adapter && !state.site;
  $('modify').textContent = adapter ? '[ modify view ]' : '[ edit rule ]';

  if (!state.passwordSet) {
    $('foot-note').replaceChildren();
    $('foot-note').append(Object.assign(document.createElement('a'), { href: '#', className: 'amber', textContent: 'set a password →' }));
    $('foot-note').firstChild.addEventListener('click', (e) => (e.preventDefault(), openOptions('settings')));
  }
}

$('unblock').addEventListener('click', async () => {
  await send('openUnlock', { tabId: tab.id });
  window.close();
});

$('block').addEventListener('click', async () => {
  const result = await send('blockSite', { tabId: tab.id });
  if (!result.ok) {
    $('error').textContent = result.error;
    return;
  }
  state = await send('getPopupState', { tabId: tab.id });
  render();
});

$('modify').addEventListener('click', () => {
  const domain = state.site?.domain ?? supportedAdapter(state.domain)?.domains[0] ?? state.domain;
  openOptions(`site/${encodeURIComponent(domain)}`);
});

render();
