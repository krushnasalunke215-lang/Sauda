import { LANG_TAGS, type Lang } from '../../shared/types.js';

/** Today's date in UTC as YYYY-MM-DD. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Today's date as PayPal sees it (US Pacific time), as YYYY-MM-DD. PayPal reads invoice and
 * payment dates in that zone, so a UTC date can be "tomorrow" and turn an invoice SCHEDULED.
 */
export function paypalToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** True for a real calendar date written as YYYY-MM-DD (2026-02-30 is false). */
export function isValidIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** ISO dates compare correctly as strings. */
export function isNotPast(s: string, today: string): boolean {
  return s >= today;
}

/** "December 10, 2026" / "10 दिसंबर 2026" / "10 de diciembre de 2026". */
export function formatDate(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LANG_TAGS[lang], { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}
