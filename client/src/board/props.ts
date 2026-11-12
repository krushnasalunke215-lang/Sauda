import { SAMPLE_ORDER_IDS, type BoardDependency, type BoardRow } from '../../../shared/board.js';
import { LANG_TAGS, type Lang } from '../../../shared/types.js';
import { t, tMaybe, tView } from '../i18n.js';

/** What both production boards (FallbackBoard and BryntumBoard) receive. */
export interface BoardProps {
  rows: BoardRow[];
  dependencies: BoardDependency[];
  startDate: string;
  endDate: string;
  lang: Lang;
}

/** "10 Dec" in the viewer's language. Board dates are whole UTC days. */
export function formatDay(isoDate: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LANG_TAGS[lang], { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(isoDate));
}

/** A row's name in the viewer's language. The SAUDA-<id> prefix of an order shows only in judge mode. */
export function rowLabel(row: BoardRow, lang: Lang, judge: boolean): string {
  if (row.kind === 'order') return tView(lang, row.nameKey, { ...row.params, item: row.params.item ?? t(lang, 'board.noItem') }, judge);
  if (row.key === 'ship_by') return t(lang, 'board.row.ship_by', { date: formatDay(row.params.date ?? row.endDate, lang) });
  return tMaybe(lang, row.nameKey);
}

/** True for an open payment gate that work is waiting on: the board shows "Waiting for the PayPal payment". */
export function isWaitingGate(row: BoardRow, rows: BoardRow[]): boolean {
  return row.kind === 'gate' && row.state === 'ready' && rows.some((r) => r.orderId === row.orderId && r.blockedBy === row.key);
}

/** Tooltip text for a row: its name, plus what it waits for when locked. */
export function rowTitle(row: BoardRow, lang: Lang, judge: boolean): string {
  const name = rowLabel(row, lang, judge);
  if (row.state !== 'locked' || !row.blockedBy) return `${name} · ${t(lang, `board.state.${row.state}`)}`;
  return `${name} · ${t(lang, 'board.lockedBy', { gate: tMaybe(lang, `board.row.${row.blockedBy}`) })}`;
}

/** Sample orders start folded, so the real deal's steps are what the maker sees first. */
export const startsExpanded = (orderId: string) => !SAMPLE_ORDER_IDS.includes(orderId);
