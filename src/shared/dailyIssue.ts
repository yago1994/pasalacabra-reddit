// Daily game numbering, UTC-based so client, server, and cron agree.

const LAUNCH_DATE_UTC = Date.UTC(2026, 6, 15); // 2026-07-15
const BASE_GAME_NO = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

export function utcDateKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function gameNoForDate(d: Date = new Date()): number {
  const startOfDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const delta = Math.floor((startOfDay - LAUNCH_DATE_UTC) / DAY_MS);
  return BASE_GAME_NO + Math.max(0, delta);
}

export function formatDateLong(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}
