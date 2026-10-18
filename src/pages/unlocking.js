import { send } from '../lib/ui.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const token = params.get('t');
const blockPage = params.get('back') ?? 'blocked.html';

const unlock = await send('getUnlock', { token });

function show(id) {
  for (const section of ['counting', 'done', 'expired']) $(section).hidden = section !== id;
}

$('restart').addEventListener('click', () => location.replace(blockPage));

if (!unlock.ok) {
  show('expired');
} else {
  $('domain').textContent = unlock.domain;
  if (unlock.message) {
    $('message-box').hidden = false;
    $('message').textContent = `"${unlock.message}"`;
  }
  $('continue').textContent = `[ continue to ${unlock.domain} → ]`;

  const total = unlock.cooldownSec * 1000;
  const endsAt = Date.now() + total - unlock.elapsedMs;

  const tick = async () => {
    const left = Math.max(0, endsAt - Date.now());
    $('seconds').textContent = String(Math.ceil(left / 1000)).padStart(2, '0');
    $('progress').style.width = `${Math.round(((total - left) / total) * 100)}%`;
    if (left > 0) return;
    clearInterval(timer);
    const result = await send('finishUnlock', { token });
    if (!result.ok) return show('expired');
    $('continue').href = result.url;
    show('done');
    $('continue').focus();
  };
  const timer = setInterval(tick, 250);
  tick();

  $('never-mind').addEventListener('click', async () => {
    clearInterval(timer);
    await send('cancelUnlock', { token });
    location.replace(blockPage);
  });

  $('continue').addEventListener('click', (event) => {
    event.preventDefault();
    location.replace($('continue').href);
  });

  $('keep').addEventListener('click', async () => {
    await send('revokeUnlock', { domain: unlock.domain });
    location.replace(blockPage);
  });
}
