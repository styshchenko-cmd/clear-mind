import { normalizeDomain, hostOf } from '../lib/domain.js';
import * as model from '../lib/model.js';
import { MIN_PASSWORD_LENGTH } from '../lib/password.js';
import { summarize } from '../lib/stats.js';
import {
  dayKey, daysBetween, formatDuration, formatLongDate, formatShortDate, formatTimeOfDay, todayAt, weekdayShort, MINUTE,
} from '../lib/time.js';
import { bar, h, icon, onLocalChange, readLocal, send, supportedAdapter, usageTone } from '../lib/ui.js';

const main = document.getElementById('main');
const nav = document.getElementById('nav');
const sidebarFoot = document.getElementById('sidebar-foot');

let data = await load();
let statsRange = 'today';
let listSizes = null;
let autoSelected = 'adult';

async function load() {
  const s = await readLocal(['settings', 'sites', 'auto', 'days']);
  return {
    settings: s.settings ?? { password: null, statsSince: Date.now() },
    sites: s.sites ?? {},
    auto: model.normalizeAuto(s.auto),
    days: s.days ?? {},
  };
}

// ---------------------------------------------------------------- shared bits

const label = (text, attrs = {}) => h('div', { class: 'label', ...attrs }, text);

function pageHeader(kicker, title, extra) {
  return h('div', { class: 'row wrap-row between g16', style: { alignItems: 'flex-end' } },
    h('div', { class: 'stack g4', style: { minWidth: 0 } }, label(kicker), h('h1', { class: 'page-title' }, title)),
    extra);
}

function sectionHead(text, aside, asideClass = '') {
  return h('div', { class: 'section-head label' }, h('span', {}, text), aside ? h('span', { class: `aside ${asideClass}` }, aside) : null);
}

// An inline password prompt. Resolves with the password, or null on cancel.
function askPassword(host, prompt) {
  host.replaceChildren();
  return new Promise((resolve) => {
    const input = h('input', { type: 'password', class: 'input', placeholder: 'password', autocomplete: 'current-password', 'aria-label': 'Password' });
    const done = (value) => {
      host.replaceChildren();
      resolve(value);
    };
    const form = h('form', { class: 'confirm', onsubmit: (e) => (e.preventDefault(), done(input.value)) },
      h('span', { class: 'caption', style: { flexBasis: '100%' } }, prompt),
      input,
      h('button', { type: 'submit', class: 'btn btn-strong' }, '[ confirm ]'),
      h('button', { type: 'button', class: 'btn', onclick: () => done(null) }, '[ cancel ]'));
    host.append(form);
    input.focus();
  });
}

// Runs a background action, asking for the password when it says it needs one.
async function withPassword(host, prompt, action, errorEl) {
  let result = await action(undefined);
  while (!result.ok && result.needPassword) {
    const password = await askPassword(host, result.error === 'wrong password' ? `Wrong password. ${prompt}` : prompt);
    if (password === null) return result;
    result = await action(password);
  }
  if (!result.ok && errorEl) errorEl.textContent = result.error;
  return result;
}

function renderSidebar(route) {
  nav.replaceChildren();
  if (route.view === 'site') {
    nav.append(h('div', { class: 'stack g24' },
      h('a', { class: 'nav-back', href: '#sites' }, '← all blocked sites'),
      h('div', { class: 'stack g8' },
        label('site list', { style: { padding: '0 12px' } }),
        h('div', { class: 'nav' }, Object.keys(data.sites).sort().map((d) =>
          h('a', { href: `#site/${encodeURIComponent(d)}`, 'aria-current': d === route.domain ? 'page' : null, class: 'wrap' }, d))))));
  } else {
    const items = [['stats', 'stats'], ['sites', 'blocked sites'], ['auto', 'auto mode'], ['settings', 'settings'], ['help', 'help']];
    nav.append(h('div', { class: 'nav' }, items.map(([id, text]) =>
      h('a', { href: `#${id}`, 'aria-current': route.view === id || (id === 'help' && route.view === 'setup') ? 'page' : null }, text))));
  }
  sidebarFoot.replaceChildren(`v${model.VERSION} · data stored locally`, h('br'),
    data.settings.password ? 'password set ✓' : h('a', { href: '#settings', class: 'amber' }, 'no password set'));
}

// ---------------------------------------------------------------- stats

function viewStats() {
  const now = Date.now();
  const s = summarize({ range: statsRange, days: data.days, sites: data.sites, auto: data.auto, settings: data.settings, now });
  const rangeLabel = { today: 'today', '7d': '7 days', '30d': '30 days' };

  const segmented = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Range' },
    Object.entries(rangeLabel).map(([id, text]) => h('button', {
      type: 'button', 'aria-pressed': String(statsRange === id),
      onclick: () => { statsRange = id; render(); },
    }, text)));

  const tile = (kicker, value, caption, tone = '') => h('div', { class: 'tile' },
    h('span', { class: 'label' }, kicker), h('span', { class: `tile-value ${tone}` }, value), h('span', { class: 'caption' }, caption));

  const tiles = h('div', { class: 'grid-auto', style: { '--min': '200px', gap: '12px' } },
    tile('time on listed sites', formatDuration(s.ms), s.allowedMs ? `of ${formatDuration(s.allowedMs)} allowed` : 'no daily limits set'),
    tile('blocks shown', s.blocks, 'times the block page appeared', 'red'),
    tile('unlocks', s.unlocks, 'password + cooldown', 'amber'),
    tile('days under limit', s.streak, 'current streak', 'green'));

  const siteGrid = { gridTemplateColumns: 'minmax(120px, 1.2fr) minmax(0, 3fr) auto' };
  const siteRows = s.siteRows.map((row) => {
    let barEl;
    let text;
    if (row.mode === 'limit') {
      const fraction = row.ms / row.limitMs;
      const tone = usageTone(fraction);
      barEl = bar(fraction, tone, `${formatDuration(row.ms)} of ${formatDuration(row.limitMs)}`);
      text = h('span', { class: `num ${tone === 'red' ? 'red' : ''}` }, `${formatDuration(row.ms)} / ${formatDuration(row.limitMs)}`);
    } else if (row.mode === 'block') {
      barEl = bar(0, '', 'blocked completely');
      text = h('span', { class: 'num muted' }, `blocked · ${row.blocks} attempt${row.blocks === 1 ? '' : 's'}`);
    } else {
      barEl = bar(0, '', 'watch only');
      text = h('span', { class: 'num' }, `${formatDuration(row.ms)} · watch`);
    }
    return h('div', { class: 'tr', style: siteGrid }, h('span', { class: 'medium wrap' }, row.domain), barEl, text);
  });

  const catGrid = { gridTemplateColumns: 'minmax(140px, 1.6fr) minmax(120px, 1.4fr) minmax(0, 3fr) auto' };
  const catRows = s.categoryRows.map((row) => {
    const { config } = row;
    let rule;
    let progress;
    if (config.mode === 'full') {
      const since = config.since ?? now;
      const days = daysBetween(since, now);
      rule = h('span', { class: 'red' }, 'always on');
      progress = [bar(1, 'red', 'blocked all day'),
        h('span', { class: 'caption' }, days === 0 ? 'blocked all day · since today'
          : `blocked all day · ${days} day${days === 1 ? '' : 's'} since ${formatShortDate(since)}`)];
    } else if (config.mode === 'limit') {
      const fraction = row.ms / row.limitMs;
      rule = h('span', { class: 'amber' }, `time limit · ${config.limitMin} min / day`);
      progress = [bar(fraction, usageTone(fraction), 'time used'),
        h('span', { class: 'caption' }, `${formatDuration(row.ms)} of ${formatDuration(row.limitMs)} used`)];
    } else {
      rule = h('span', { class: 'amber' }, model.categoryRuleLabel(config));
      const w = config.window;
      if (w && w.end > todayAt(0, 0, now)) {
        const elapsed = Math.min(now, w.end) - w.start;
        const running = now < w.end;
        progress = [bar(elapsed / (w.end - w.start), running ? 'amber' : '', 'focus window progress'),
          h('span', { class: 'caption' }, running
            ? `blocked ${formatDuration(elapsed)} · since ${formatTimeOfDay(w.start)} · ${formatDuration(w.end - now)} left`
            : `blocked ${formatDuration(elapsed)} · ${formatTimeOfDay(w.start)}–${formatTimeOfDay(w.end)}`)];
      } else {
        progress = [bar(0, '', 'no focus window today'), h('span', { class: 'caption' }, 'no focus window today')];
      }
    }
    return h('div', { class: 'tr', style: catGrid },
      h('span', { class: 'medium' }, row.label), rule, h('div', { class: 'stack g6', style: { minWidth: 0 } }, progress),
      h('span', { class: `num ${row.blocks ? 'red' : ''}` }, row.blocks));
  });

  const peak = Math.max(1, s.dailyLimitMs, ...s.chart.map((d) => d.ms)) * 1.1;
  const gap = s.chart.length > 7 ? '4px' : '12px';
  const cols = `repeat(${s.chart.length}, minmax(0, 1fr))`;
  const chart = h('div', { class: 'chart' },
    h('div', { class: 'chart-bars', style: { gridTemplateColumns: cols, '--gap': gap }, role: 'img', 'aria-label': 'Daily time on listed sites' },
      s.chart.map((d) => h('span', {
        class: d.over ? 'over' : d.today ? 'today' : '',
        style: { height: `${(d.ms / peak) * 100}%` },
        title: `${formatShortDate(d.time)} · ${formatDuration(d.ms)}`,
      })),
      s.dailyLimitMs ? h('div', { class: 'chart-limit', style: { bottom: `${(s.dailyLimitMs / peak) * 100}%` } }) : null),
    h('div', { class: 'chart-labels caption', style: { gridTemplateColumns: cols, '--gap': gap } },
      s.chart.map((d, i) => h('span', {}, d.today ? 'today'
        : s.chart.length > 7 ? (i % 5 === 0 ? new Date(d.time).getDate() : '') : weekdayShort(d.time)))));

  return [
    pageHeader('user stats', formatLongDate(now), segmented),
    tiles,
    h('section', { class: 'stack g12' },
      h('div', { class: 'row between g12 label' }, h('span', {}, `by site · ${rangeLabel[statsRange]}`), h('span', {}, 'used / limit')),
      h('div', { class: 'table' }, siteRows.length ? siteRows
        : h('div', { class: 'empty' }, 'No sites yet. ', h('a', { href: '#sites' }, 'add one →')))),
    catRows.length ? h('section', { class: 'stack g12' },
      h('div', { class: 'row between g12 label' }, h('span', {}, 'auto mode · categories'), h('span', {}, 'blocked for')),
      h('div', { class: 'table' },
        h('div', { class: 'tr th label', style: catGrid }, h('span', {}, 'category'), h('span', {}, 'rule'), h('span', {}, 'today'), h('span', {}, 'attempts')),
        catRows)) : null,
    h('section', { class: 'stack g12' },
      h('div', { class: 'row between g12 label' },
        h('span', {}, `last ${s.chart.length} days · time on listed sites`), s.dailyLimitMs ? h('span', {}, 'limit ─ ─') : null),
      chart),
  ];
}

// ---------------------------------------------------------------- blocked sites

// "Social feeds" (focus window · 2 hours), for each category overlapping a site.
const overlapNames = (overlaps) => overlaps.map((o) => `"${o.label}" (${o.rule})`).join(', ');

function overlapNotice(domain, overlaps) {
  const covered = overlaps.filter((o) => o.covering);
  const inside = overlaps.filter((o) => !o.covering);
  return h('div', { class: 'notice', role: 'note' },
    h('span', { class: 'amber medium' }, 'overrides auto mode'),
    covered.length ? h('span', {}, `${domain} is also in ${overlapNames(covered)}.`) : null,
    inside.map((o) => h('span', {}, `${o.under} ${o.label} domain${o.under === 1 ? '' : 's'} sit under ${domain} (${o.examples.join(', ')}${o.under > o.examples.length ? ', …' : ''}).`)),
    h('span', { class: 'caption' }, 'This entry overrides auto mode for this domain: the rule below applies instead of the category. A rule weaker than the category asks for your password.'));
}

function siteSummary(site) {
  const adapter = supportedAdapter(site.domain);
  const parts = [];
  if (adapter) {
    for (const option of adapter.options) {
      if (site.modify[option.key] ?? option.default) parts.push(option.summary);
    }
    if (site.modify.grayscale) parts.push('grayscale');
  }
  if (parts.length) return parts.join(' · ');
  if (site.mode === 'watch') return 'time tracked only';
  if (site.show === 'redirect' && site.redirectUrl) return `redirects to ${hostOf(site.redirectUrl) ?? site.redirectUrl}`;
  return 'block page with your message';
}

function viewSites() {
  const sites = Object.values(data.sites).sort((a, b) => a.domain.localeCompare(b.domain));
  const withLimits = sites.filter((s) => s.mode === 'limit').length;
  const today = data.days[dayKey()] ?? model.emptyDay();
  const error = h('p', { class: 'error', role: 'alert', style: { margin: 0, flexBasis: '100%' } });
  const input = h('input', { id: 'domain', type: 'text', class: 'input', placeholder: 'domain, e.g. news.ycombinator.com', style: { flex: '1 1 260px', width: 'auto', minWidth: 0 } });

  const addForm = h('form', {
    class: 'row wrap-row g10 card', style: { padding: '12px 16px', gap: '10px', flexDirection: 'row' },
    onsubmit: (e) => {
      e.preventDefault();
      const domain = normalizeDomain(input.value);
      if (!domain) return (error.textContent = 'Enter a domain like news.ycombinator.com');
      location.hash = `site/${encodeURIComponent(domain)}`;
    },
  },
  h('label', { for: 'domain', class: 'green strong' }, '> add'), input,
  h('button', { type: 'submit', class: 'btn btn-primary' }, '[ add → configure ]'), error);

  const grid = { gridTemplateColumns: 'minmax(140px, 2fr) minmax(110px, 1.4fr) minmax(90px, 1fr) auto', padding: '10px 16px' };
  const rows = sites.map((site) => {
    const used = today.sites[site.domain]?.ms ?? 0;
    const blocks = today.sites[site.domain]?.blocks ?? 0;
    const ruleTone = { limit: 'amber', block: 'red', watch: 'muted' }[site.mode];
    let todayCell;
    if (site.mode === 'block') todayCell = h('span', { class: 'num muted' }, `${blocks} attempt${blocks === 1 ? '' : 's'}`);
    else if (site.mode === 'limit' && used >= site.limitMin * MINUTE) todayCell = h('span', { class: 'num red' }, `${formatDuration(used)} · limit hit`);
    else todayCell = h('span', { class: 'num' }, formatDuration(used));
    const confirmHost = h('div', { class: 'slot', style: { gridColumn: '1 / -1' } });
    const rowError = h('p', { class: 'error', role: 'alert', style: { margin: 0, gridColumn: '1 / -1' } });
    const remove = async () => {
      const result = await withPassword(confirmHost, `Enter your password to remove ${site.domain}.`,
        (password) => send('removeSite', { domain: site.domain, password }), rowError);
      if (result.ok) render();
    };
    return h('div', { class: 'tr', style: grid },
      h('div', { class: 'stack g2', style: { minWidth: 0 } }, h('span', { class: 'medium wrap' }, site.domain), h('span', { class: 'caption' }, siteSummary(site)),
        h('span', { class: 'caption amber slot', dataset: { overlap: site.domain } })),
      h('span', { class: ruleTone }, model.ruleLabel(site)),
      todayCell,
      h('div', { class: 'row g8', style: { justifyContent: 'flex-end' } },
        h('a', { href: `#site/${encodeURIComponent(site.domain)}`, class: 'icon-btn', 'aria-label': `Edit ${site.domain}` }, icon('edit')),
        h('button', { type: 'button', class: 'icon-btn quiet', 'aria-label': `Remove ${site.domain}`, onclick: remove }, icon('trash'))),
      confirmHost, rowError);
  });

  if (sites.length) {
    send('getOverlaps', { domains: sites.map((s) => s.domain) }).then((r) => {
      for (const [domain, overlaps] of Object.entries(r.overlaps ?? {})) {
        const slot = main.querySelector(`[data-overlap="${CSS.escape(domain)}"]`);
        if (slot && overlaps.length) slot.textContent = `overrides auto mode: ${overlaps.map((o) => o.label.toLowerCase()).join(', ')}`;
      }
    });
  }

  return [
    pageHeader('blocked sites', `${sites.length} site${sites.length === 1 ? '' : 's'} · ${withLimits} with limits`),
    addForm,
    h('div', { class: 'table' },
      h('div', { class: 'tr th label', style: grid }, h('span', {}, 'site'), h('span', {}, 'rule'), h('span', {}, 'today'), h('span', { style: { width: '96px', textAlign: 'right' } }, 'actions')),
      rows.length ? rows : h('div', { class: 'empty' }, 'Nothing here yet. Add a domain above.')),
    h('p', { class: 'caption', style: { margin: 0 } }, 'Removing a site asks for your password. Rules reset at 00:00 local time.'),
  ];
}

// ---------------------------------------------------------------- site edit

function viewSite(domain) {
  const existing = data.sites[domain];
  const site = existing ? structuredClone(existing) : model.newSite(domain);
  const adapter = supportedAdapter(domain);
  const notice = h('div', { class: 'slot' });
  send('getOverlaps', { domains: [domain] }).then((r) => {
    const overlaps = r.overlaps?.[domain] ?? [];
    if (overlaps.length) notice.replaceChildren(overlapNotice(domain, overlaps));
  });
  const error = h('p', { class: 'error', role: 'alert', style: { margin: 0 } });
  const confirmHost = h('div', { class: 'slot' });

  const modeCard = (mode, title, caption) => h('label', { class: 'option' },
    h('input', { type: 'radio', name: 'mode', value: mode, checked: site.mode === mode, onchange: sync }),
    h('span', { class: 'stack g2' }, h('span', { class: 'medium' }, title), h('span', { class: 'caption' }, caption)));

  const limit = h('input', { id: 'limit', type: 'number', class: 'input short', value: site.limitMin, min: 1, max: 1440 });
  const cooldown = h('input', { id: 'cooldown', type: 'number', class: 'input short', value: site.cooldownSec, min: model.MIN_COOLDOWN_SEC, max: model.MAX_COOLDOWN_SEC });
  const message = h('textarea', { class: 'input', rows: 2, 'aria-label': 'Block page message' });
  message.value = site.message;
  const redirectUrl = h('input', { type: 'url', class: 'input', 'aria-label': 'Redirect URL', placeholder: 'https://', value: site.redirectUrl });
  const cooldownMessage = h('input', { id: 'cooldown-message', type: 'text', class: 'input', value: site.cooldownMessage });

  const form = h('form', { class: 'stack g32', onsubmit: (e) => e.preventDefault() });
  const value = (name) => form.querySelector(`input[name="${name}"]:checked`)?.value;

  function sync() {
    const mode = value('mode');
    limit.disabled = mode !== 'limit';
    const showRedirect = value('show') === 'redirect';
    message.disabled = showRedirect;
    redirectUrl.disabled = !showRedirect;
  }

  const behavior = h('section', { class: 'stack g16' },
    sectionHead('behavior'),
    h('fieldset', { class: 'stack g10' },
      h('legend', {}, 'What happens on this site'),
      h('div', { class: 'grid-auto' },
        modeCard('block', 'Block', 'block page every time'),
        modeCard('limit', 'Time limit', 'allowed N minutes per day'),
        modeCard('watch', 'Watch', 'track time only, never block'))),
    h('div', { class: 'grid-auto', style: { '--min': '260px', gap: '16px' } },
      h('div', { class: 'field' }, h('label', { for: 'limit' }, 'Daily limit'),
        h('div', { class: 'row g10' }, limit, h('span', { class: 'muted' }, 'min / day · resets 00:00'))),
      h('div', { class: 'field' }, h('label', { for: 'cooldown' }, 'Unlock cooldown'),
        h('div', { class: 'row g10' }, cooldown, h('span', { class: 'muted' }, 'seconds after password')))),
    h('fieldset', { class: 'stack g10' },
      h('legend', {}, 'When blocked, show'),
      h('label', { class: 'radio-line' }, h('input', { type: 'radio', name: 'show', value: 'message', checked: site.show !== 'redirect', onchange: sync }), h('span', {}, 'a message from me')),
      message,
      h('label', { class: 'radio-line' }, h('input', { type: 'radio', name: 'show', value: 'redirect', checked: site.show === 'redirect', onchange: sync }), h('span', {}, 'redirect to')),
      redirectUrl),
    h('div', { class: 'field' }, h('label', { for: 'cooldown-message' }, 'Message during the cooldown'), cooldownMessage));
  form.append(behavior);

  if (adapter) {
    const options = [...adapter.options, { key: 'grayscale', label: 'Grayscale images & video', default: false }];
    form.append(h('section', { class: 'stack g16' },
      sectionHead('modify view', `${adapter.label} is supported`, 'green'),
      h('p', { class: 'caption', style: { margin: 0 } }, 'Applies while the site is allowed. Keeps the parts you came for, hides the parts that keep you there.'),
      h('div', { class: 'grid-auto', style: { '--min': '200px' } }, options.map((o) =>
        h('label', { class: 'option center' },
          h('input', { type: 'checkbox', name: 'modify', value: o.key, checked: site.modify[o.key] ?? o.default }),
          h('span', {}, o.label))))));
  }

  const collect = () => ({
    ...site,
    mode: value('mode'),
    limitMin: limit.value,
    cooldownSec: cooldown.value,
    show: value('show'),
    message: message.value.trim(),
    redirectUrl: redirectUrl.value.trim(),
    cooldownMessage: cooldownMessage.value.trim(),
    modify: Object.fromEntries([...form.querySelectorAll('input[name="modify"]')].map((c) => [c.value, c.checked])),
  });

  const save = async () => {
    error.textContent = '';
    const result = await withPassword(confirmHost, 'This loosens a rule (or overrides a stricter auto-mode category). Enter your password to save it.',
      (password) => send('saveSite', { site: collect(), password }), error);
    if (result.ok) location.hash = 'sites';
  };

  const remove = async () => {
    error.textContent = '';
    const result = await withPassword(confirmHost, `Enter your password to remove ${domain}.`,
      (password) => send('removeSite', { domain, password }), error);
    if (result.ok) location.hash = 'sites';
  };

  form.append(h('div', { class: 'stack g12', style: { paddingTop: '20px', borderTop: '1px solid var(--border)' } },
    confirmHost, error,
    h('div', { class: 'row wrap-row between g12' },
      existing ? h('button', { type: 'button', class: 'btn btn-danger', onclick: remove }, '[ remove from block list ]') : h('span'),
      h('div', { class: 'row wrap-row g10' },
        h('a', { href: '#sites', class: 'btn' }, '[ cancel ]'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, existing ? '[ save ]' : '[ add site ]')))));

  sync();
  return [
    pageHeader(existing ? 'blocked sites / edit' : 'blocked sites / new', domain,
      h('div', { class: 'row wrap-row g8' },
        h('span', { class: 'chip' }, existing ? `added ${formatShortDate(existing.addedAt)}` : 'not saved yet'),
        adapter ? h('span', { class: 'chip on' }, 'modify supported') : null)),
    notice,
    form,
  ];
}

// ---------------------------------------------------------------- auto mode

function formatCount(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);
}

// The short state shown on a category card.
function categoryBadge(config, now) {
  if (config.mode === 'off') return '[ off ]';
  if (config.mode === 'full') return '[ always ]';
  if (config.mode === 'limit') return `[ ${config.limitMin}m / day ]`;
  return model.windowRunning(config, now) ? `[ until ${formatTimeOfDay(config.window.end)} ]` : '[ window ]';
}

function viewAuto(selected) {
  const now = Date.now();
  if (selected && model.categoryById(selected)) autoSelected = selected;
  const draft = structuredClone(data.auto);
  const error = h('p', { class: 'error', role: 'alert', style: { margin: 0 } });
  const confirmHost = h('div', { class: 'slot' });
  const onCount = h('span', {});
  const panel = h('section', { class: 'stack g16' });

  const cards = model.CATEGORIES.map((c) => h('button', {
    type: 'button', class: 'toggle', dataset: { category: c.id },
    onclick: () => {
      autoSelected = c.id;
      paint();
    },
  },
  h('span', { class: 'stack g2' }, h('span', { class: 'medium' }, c.label), h('span', { class: 'caption' }, c.hint)),
  h('span', { class: 'state' })));

  function paint() {
    for (const card of cards) {
      const config = draft.categories[card.dataset.category];
      card.setAttribute('aria-pressed', String(card.dataset.category === autoSelected));
      const state = card.querySelector('.state');
      state.textContent = categoryBadge(config, now);
      state.classList.toggle('on', config.mode !== 'off');
    }
    onCount.textContent = `${model.CATEGORIES.filter((c) => draft.categories[c.id].mode !== 'off').length} on`;
    paintPanel();
  }

  function paintPanel() {
    const category = model.categoryById(autoSelected);
    const config = draft.categories[category.id];
    const saved = data.auto.categories[category.id];
    const running = model.windowRunning(saved, now) ? saved.window : null;

    const radio = (mode) => h('input', {
      type: 'radio', name: 'how', value: mode, checked: config.mode === mode, style: { marginTop: '2px' },
      onchange: () => {
        config.mode = mode;
        paint();
      },
    });
    const card = (mode, title, caption, ...extra) => h('label', { class: 'option', style: { padding: '16px' } }, radio(mode),
      h('span', { class: 'stack g10 grow', style: { minWidth: 0 } },
        h('span', { class: 'stack g2' }, h('span', { class: 'medium' }, title), h('span', { class: 'caption' }, caption)),
        extra));

    const select = h('select', {
      class: 'input', 'aria-label': 'Focus window length',
      onchange: () => (config.windowLength = select.value),
    }, model.WINDOW_LENGTHS.map((w) => h('option', { value: w.id, selected: w.id === config.windowLength, disabled: w.end(now) <= now }, w.label)));
    const limit = h('input', {
      type: 'number', class: 'input short', min: 1, max: 1440, value: config.limitMin, 'aria-label': 'Daily limit in minutes',
      oninput: () => (config.limitMin = limit.value),
    });

    panel.replaceChildren(
      sectionHead(`how hard · "${category.label}"`,
        running ? `focus window running · until ${formatTimeOfDay(running.end)}` : `now: ${model.categoryRuleLabel(saved)}`,
        running ? 'amber' : ''),
      h('fieldset', { class: 'grid-auto', style: { '--min': '200px' } },
        h('legend', { class: 'sr-only' }, `Block strength for ${category.label}`),
        card('off', 'Off', 'not blocked'),
        card('window', 'Block for some time', 'a focus window · unblocks itself after',
          h('span', { class: 'row wrap-row g8' }, select,
            h('button', { type: 'button', class: 'btn btn-primary', onclick: (e) => (e.preventDefault(), submit(category.id)) }, '[ start ]'))),
        card('limit', 'Time limit', 'its sites share a daily allowance',
          h('span', { class: 'row g10' }, limit, h('span', { class: 'muted' }, 'min / day'))),
        card('full', 'Block completely', 'always on · password + cooldown to open anything',
          h('span', { class: 'caption amber' }, 'turning this off later asks for the password too'))));
  }

  const submit = async (startWindow) => {
    error.textContent = '';
    const result = await withPassword(confirmHost, 'This loosens auto mode. Enter your password to save it.',
      (password) => send('saveAuto', { categories: draft.categories, startWindow, password }), error);
    if (result.ok) {
      data = await load();
      render();
    }
  };

  const sizes = h('span', { class: 'caption' }, 'lists: loading…');
  const showSizes = (s) => (sizes.textContent = 'lists: ' + model.CATEGORIES.map((c) => `${c.id} ${formatCount(s[c.id] ?? 0)}`).join(' · ') + ' domains');
  if (listSizes) showSizes(listSizes);
  else send('getListSizes').then((r) => r.ok && showSizes((listSizes = r.sizes)));

  paint();
  return [
    h('div', { class: 'stack g4' },
      label('auto mode'),
      h('h1', { class: 'page-title' }, 'Block by category'),
      h('p', { class: 'muted', style: { margin: '4px 0 0', maxWidth: '640px' } },
        'Built-in domain lists, kept on your device. Pick a category, then choose how hard it is blocked. Sites you configured one by one keep their own rules.')),
    h('section', { class: 'stack g16' }, sectionHead('categories', onCount), h('div', { class: 'grid-auto' }, cards)),
    panel,
    h('div', { class: 'stack g12', style: { paddingTop: '20px', borderTop: '1px solid var(--border)' } },
      confirmHost, error,
      h('div', { class: 'row wrap-row between g12' }, sizes,
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => submit(null) }, '[ save ]'))),
  ];
}

// ---------------------------------------------------------------- setup & help

const GUIDE = [
  ['stats', 'stats', 'Time on your listed sites, blocks shown, unlocks and your streak of days under the limit.'],
  ['sites', 'blocked sites', 'Lets you block or time-limit certain sites, write the message the block page shows, and hide feeds with modify view.'],
  ['auto', 'auto mode', 'Blocks whole categories (adult, social feeds, news, video, shopping, gambling): off, for a focus window, with a daily limit, or always.'],
  ['settings', 'settings', 'Change your password or reset the statistics.'],
  ['help', 'help', 'This page.'],
];

const EVERYDAY = [
  ['toolbar icon', 'Shows the current site, its rule and time left today. Block the site you are on with one click.'],
  ['block page', 'Appears instead of a blocked site, with your message. "[ still need it? ]" → password → a short cooldown → the site opens in that tab until you close it or midnight.'],
];

// First-run setup (`setup`) and the help page share this view; setup asks for
// the password right here, help points to settings instead.
function viewGuide(setup) {
  const hasPassword = Boolean(data.settings.password);
  let top;
  if (setup && !hasPassword) {
    const error = h('p', { class: 'error', role: 'alert', style: { margin: 0 } });
    const field = (id, text) => h('div', { class: 'field' }, h('label', { for: id }, text),
      h('input', { id, type: 'password', class: 'input', autocomplete: 'new-password' }));
    const setPassword = async (e) => {
      e.preventDefault();
      error.textContent = '';
      const next = document.getElementById('setup-pw').value;
      if (next.length < MIN_PASSWORD_LENGTH) return (error.textContent = `Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      if (next !== document.getElementById('setup-pw-repeat').value) return (error.textContent = "The passwords don't match.");
      const result = await send('setPassword', { next });
      if (!result.ok) return (error.textContent = result.error);
      data = await load();
      render();
    };
    top = h('section', { class: 'stack g16', style: { maxWidth: '640px' } },
      sectionHead('unblock password', 'step 1', 'amber'),
      h('p', { style: { margin: 0 } }, 'Your key for unblocking sites. It cannot be recovered.'),
      h('form', { class: 'stack g12', onsubmit: setPassword },
        h('div', { class: 'grid-auto', style: { '--min': '240px', gap: '12px' } },
          field('setup-pw', 'Password'), field('setup-pw-repeat', 'Repeat password')),
        error,
        h('div', { class: 'row wrap-row between g12' },
          h('span', { class: 'caption' }, `at least ${MIN_PASSWORD_LENGTH} characters · stored as a hash on this device`),
          h('button', { type: 'submit', class: 'btn btn-primary' }, '[ set password ]'))));
  } else if (setup) {
    top = h('section', { class: 'stack g16', style: { maxWidth: '640px' } },
      sectionHead('unblock password', 'set ✓', 'green'),
      h('p', { style: { margin: 0 } }, 'Done. Next, add the first site you want to keep away from.'),
      h('div', {}, h('a', { href: '#sites', class: 'btn btn-primary' }, '[ add your first site → ]')));
  } else {
    top = h('section', { class: 'stack g16', style: { maxWidth: '640px' } },
      sectionHead('unblock password', hasPassword ? 'set ✓' : 'not set', hasPassword ? 'green' : 'amber'),
      h('p', { style: { margin: 0 } }, 'Your key for unblocking sites. It cannot be recovered. ',
        h('a', { href: '#settings', style: { whiteSpace: 'nowrap' } }, hasPassword ? 'change it in settings →' : 'set it up in settings →')));
  }

  const rows = (items, link) => h('div', { class: 'table' }, items.map(([id, name, text]) =>
    h('div', { class: 'tr', style: { gridTemplateColumns: 'minmax(130px, 180px) 1fr', alignItems: 'start' } },
      link ? h('a', { href: `#${id}`, class: 'medium' }, name) : h('span', { class: 'medium' }, id),
      h('span', { class: 'muted' }, link ? text : name))));

  return [
    pageHeader(setup ? 'setup' : 'help', setup ? 'Welcome to ClearMind' : 'How ClearMind works'),
    top,
    h('section', { class: 'stack g16', style: { maxWidth: '860px' } },
      sectionHead('the pages on the left'),
      rows(GUIDE, true)),
    h('section', { class: 'stack g16', style: { maxWidth: '860px' } },
      sectionHead('while you browse'),
      rows(EVERYDAY, false)),
    h('p', { class: 'caption', style: { margin: 0 } }, 'Everything stays on this device. ClearMind makes no network requests.'),
  ];
}

// ---------------------------------------------------------------- settings

function viewSettings() {
  const hasPassword = Boolean(data.settings.password);
  const field = (id, text, autocomplete) => h('div', { class: 'field' },
    h('label', { for: id }, text), h('input', { id, type: 'password', class: 'input', autocomplete }));
  const pwError = h('p', { class: 'error', role: 'alert', style: { margin: 0 } });
  const pwOk = h('p', { class: 'ok-msg', role: 'status', style: { margin: 0 } });

  const changePassword = async (e) => {
    e.preventDefault();
    pwError.textContent = pwOk.textContent = '';
    const current = document.getElementById('pw-current')?.value;
    const next = document.getElementById('pw-new').value;
    if (next.length < MIN_PASSWORD_LENGTH) return (pwError.textContent = `Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (next !== document.getElementById('pw-confirm').value) return (pwError.textContent = "The new passwords don't match.");
    const result = await send('setPassword', { current, next });
    if (!result.ok) return (pwError.textContent = result.error);
    data = await load();
    render();
    document.querySelector('.ok-msg').textContent = hasPassword ? 'Password changed.' : 'Password set.';
  };

  const resetError = h('p', { class: 'error', role: 'alert', style: { margin: 0 } });
  const resetInput = h('input', { id: 'pw-reset', type: 'password', class: 'input', placeholder: hasPassword ? 'password to confirm' : 'type RESET to confirm', autocomplete: 'current-password', style: { flex: '1 1 220px', width: 'auto', minWidth: 0 } });
  const resetStats = async (e) => {
    e.preventDefault();
    resetError.textContent = '';
    if (!hasPassword && resetInput.value !== 'RESET') return (resetError.textContent = 'Type RESET to confirm.');
    const result = await send('resetStats', { password: resetInput.value });
    if (!result.ok) return (resetError.textContent = result.error);
    location.hash = 'stats';
  };

  return [
    pageHeader('settings', 'Password & data'),
    h('section', { class: 'stack g16', style: { maxWidth: '640px' } },
      sectionHead('password', hasPassword ? `set on ${formatShortDate(data.settings.passwordSetAt)}` : 'not set', hasPassword ? 'green' : 'amber'),
      hasPassword ? null : h('p', { class: 'amber', style: { margin: 0 } }, 'Set a password first. Until then, anything can be unlocked with just the cooldown.'),
      h('p', { class: 'caption', style: { margin: 0 } }, 'Asked for when you unlock a site, remove one from the list, loosen a rule, turn off "block completely", or reset the stats. Stored as a hash on this device only — there is no recovery if you forget it.'),
      h('form', { class: 'stack g12', onsubmit: changePassword },
        hasPassword ? field('pw-current', 'Current password', 'current-password') : null,
        h('div', { class: 'grid-auto', style: { '--min': '260px', gap: '12px' } },
          field('pw-new', hasPassword ? 'New password' : 'Password', 'new-password'),
          field('pw-confirm', hasPassword ? 'Repeat new password' : 'Repeat password', 'new-password')),
        pwError, pwOk,
        h('div', { class: 'row wrap-row between g12' },
          h('span', { class: 'caption' }, `at least ${MIN_PASSWORD_LENGTH} characters · changing it does not unlock anything`),
          h('button', { type: 'submit', class: 'btn btn-primary' }, hasPassword ? '[ change password ]' : '[ set password ]')))),
    h('section', { class: 'stack g16', style: { maxWidth: '640px' } },
      sectionHead('statistics', `collected since ${formatShortDate(data.settings.statsSince)}`),
      h('div', { class: 'stack g12', style: { padding: '16px', border: '1px solid var(--red)', borderRadius: '4px' } },
        h('div', { class: 'stack g4' }, h('span', { class: 'medium' }, 'Reset statistics'),
          h('span', { class: 'caption' }, 'Clears all time counters, block counts, unlocks and streaks and starts from a blank page. Your block list, categories and password stay. Cannot be undone.')),
        h('form', { class: 'row wrap-row g10', onsubmit: resetStats },
          h('label', { for: 'pw-reset', class: 'sr-only' }, 'Password to confirm'), resetInput,
          h('button', { type: 'submit', class: 'btn btn-danger', style: { flex: '0 0 auto' } }, '[ reset stats ]')),
        resetError)),
  ];
}

// ---------------------------------------------------------------- routing

function route() {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash.startsWith('site/')) return { view: 'site', domain: normalizeDomain(hash.slice(5)) };
  if (hash.startsWith('auto/')) return { view: 'auto', category: hash.slice(5) };
  return { view: ['stats', 'sites', 'auto', 'settings', 'setup', 'help'].includes(hash) ? hash : 'stats' };
}

function render() {
  const r = route();
  if (r.view === 'site' && !r.domain) return void (location.hash = 'sites');
  renderSidebar(r);
  const views = { stats: viewStats, sites: viewSites, auto: () => viewAuto(r.category), settings: viewSettings, setup: () => viewGuide(true), help: () => viewGuide(false), site: () => viewSite(r.domain) };
  main.replaceChildren(...views[r.view]().filter(Boolean));
  document.title = `ClearMind · ${r.view === 'site' ? r.domain : r.view}`;
}

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
});

// Live data: re-render read-only views; never clobber a form being edited.
onLocalChange(async () => {
  data = await load();
  const view = route().view;
  if (view === 'stats' || view === 'sites') render();
  else renderSidebar(route());
});

await send('flush').catch(() => {});
data = await load();
render();
setInterval(() => route().view === 'stats' && send('flush'), 30_000);
