export const SALON_TIMEZONE = 'Africa/Kampala';
export const SALON_MIDNIGHT_OPERATING_HOURS = 'Mon - Sun: 08:00 AM - 12:00 AM (Midnight)';

/**
 * Returns YYYY-MM-DD in the salon's local timezone (Busia, Uganda - EAT UTC+3),
 * so each business day closes cleanly at 12:00 AM midnight.
 */
export function getSalonTodayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SALON_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Returns minutes elapsed since midnight (0..1439) in the salon's timezone.
 */
export function getSalonCurrentMinutes(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SALON_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

export function getSalonCurrentTimeHHmm(now: Date = new Date()): string {
  const mins = getSalonCurrentMinutes(now);
  const hh = String(Math.floor(mins / 60) % 24).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Computes milliseconds remaining until the next 00:00:00 midnight close in Africa/Kampala.
 */
export function msUntilNextSalonMidnight(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SALON_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const second = Number(parts.find((p) => p.type === 'second')?.value ?? '0');
  const elapsedMsToday = ((hour * 60 + minute) * 60 + second) * 1000 + now.getMilliseconds();
  const oneDayMs = 24 * 60 * 60 * 1000;
  return Math.max(1000, oneDayMs - elapsedMsToday + 150);
}
