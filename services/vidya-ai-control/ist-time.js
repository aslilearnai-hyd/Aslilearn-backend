/**
 * Calendar operations in Asia/Kolkata for school-facing windows.
 */

export function istYmd(d = new Date()) {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function addIstDays(ymd, deltaDays) {
  const ms = Date.parse(`${ymd}T12:00:00+05:30`);
  if (!Number.isFinite(ms)) return ymd;
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms + deltaDays * 86400000));
}

/** Monday–Sunday IST date strings (YYYY-MM-DD) for the week containing `d`. */
export function istWeekDateKeys(d = new Date()) {
  const today = istYmd(d);
  const ms = Date.parse(`${today}T12:00:00+05:30`);
  const weekdayLong = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
  }).format(new Date(ms));
  const order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const idx = order.indexOf(weekdayLong);
  const mondayOffset = idx >= 0 ? idx : 0;
  const monday = addIstDays(today, -mondayOffset);
  const keys = [];
  for (let i = 0; i < 7; i += 1) keys.push(addIstDays(monday, i));
  return keys;
}

export function istStartOfDayInstant(ymd) {
  return new Date(`${ymd}T00:00:00+05:30`);
}

export function istEndOfDayInstant(ymd) {
  return new Date(`${ymd}T23:59:59.999+05:30`);
}
