// Local-time helpers. Days are keyed by local date ("2026-10-18") because
// limits reset at 00:00 local time.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const pad = (n) => String(n).padStart(2, '0');

export function dayKey(time = Date.now()) {
  const d = new Date(time);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(time = Date.now()) {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function nextMidnight(time = Date.now()) {
  const d = new Date(time);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

// Local time today at hh:mm.
export function todayAt(hours, minutes = 0, time = Date.now()) {
  const d = new Date(time);
  d.setHours(hours, minutes, 0, 0);
  return d.getTime();
}

// Day keys for the `count` days ending with the day of `time`, oldest first.
export function lastDays(count, time = Date.now()) {
  const keys = [];
  const d = new Date(time);
  d.setHours(12, 0, 0, 0); // noon keeps DST shifts from skipping a date
  for (let i = count - 1; i >= 0; i--) {
    const day = new Date(d);
    day.setDate(d.getDate() - i);
    keys.push(dayKey(day.getTime()));
  }
  return keys;
}

export function parseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

// 00:24:10
export function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

// 1h 12m · 45m · 0m
export function formatDuration(ms) {
  const minutes = Math.max(0, Math.floor(ms / MINUTE));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// 13:30
export function formatTimeOfDay(time) {
  const d = new Date(time);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// 3 Oct
export function formatShortDate(time) {
  const d = new Date(time);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// Sunday, 18 Oct
export function formatLongDate(time) {
  return `${WEEKDAYS[new Date(time).getDay()]}, ${formatShortDate(time)}`;
}

// mon, tue, ...
export function weekdayShort(time) {
  return WEEKDAYS[new Date(time).getDay()].slice(0, 3).toLowerCase();
}

// Whole calendar days between two times (local), e.g. 3 Oct → 18 Oct = 15.
export function daysBetween(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY);
}
