import { api } from '../lib/api.js';
import { ruleLabel } from '../lib/model.js';
import { formatClock, formatTimeOfDay, MINUTE } from '../lib/time.js';
import { optionsUrl, send } from '../lib/ui.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const domain = params.get('d') ?? '';
const reason = params.get('r') ?? 'block';
const category = params.get('c') || null;
const originalUrl = params.get('u') ?? '';

const info = await send('getBlockInfo', { domain, category });
const site = info.site;

document.title = `${domain} · blocked`;
$('domain').textContent = domain;
$('rule').textContent = category ? `category: ${info.categoryLabel.toLowerCase()}` : `rule: ${ruleLabel(site)}`;

const REASONS = {
  block: 'You put this site on your block list.',
  limit: `You put this site on your block list. Today's ${site?.limitMin} minutes are used up.`,
  manual: 'You blocked this site for the rest of today.',
};
$('reason').textContent = category
  ? `This site is in "${info.categoryLabel}", a category you block.` +
    (info.windowEnd ? ` The focus window ends at ${formatTimeOfDay(info.windowEnd)}.` : '')
  : REASONS[reason] ?? REASONS.block;

if (site?.message) {
  $('message-box').hidden = false;
  $('message').textContent = `"${site.message}"`;
}

if (site) {
  $('time').textContent =
    site.mode === 'limit' ? `${formatClock(info.usedMs)} / ${formatClock(site.limitMin * MINUTE)}` : formatClock(info.usedMs);
} else {
  $('time-tile').hidden = true;
}
$('unlocks').textContent = info.unlocksThisWeek;

const cooldown = info.cooldownSec;
$('unlock').textContent = `[ unlock → ${cooldown} s ]`;
if (info.passwordSet) {
  $('unlock-label').textContent = `Still need it? Enter your password — then a ${cooldown} s cooldown before the page opens.`;
  $('pw').focus();
} else {
  $('unlock-label').textContent = `Still need it? No password is set yet, so it's just a ${cooldown} s cooldown.`;
  $('pw').hidden = true;
}

$('unlock-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('unlock').disabled = true;
  const result = await send('startUnlock', { domain, category, url: originalUrl, password: $('pw').value });
  $('unlock').disabled = false;
  if (!result.ok) {
    $('error').textContent = result.error;
    $('pw').select();
    return;
  }
  const next = new URLSearchParams({ t: result.token, back: location.href });
  location.replace(`unlocking.html?${next}`);
});

$('back').addEventListener('click', async (event) => {
  event.preventDefault();
  if (history.length > 1) history.back();
  else api.tabs.remove((await api.tabs.getCurrent()).id);
});

$('edit').href = optionsUrl(category ? 'auto' : `site/${encodeURIComponent(domain)}`);
