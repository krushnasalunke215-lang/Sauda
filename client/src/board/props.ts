import { SAMPLE_ORDER_IDS, type BoardDependency, type BoardRow } from '../../../shared/board.js';
import type { Lang } from '../../../shared/types.js';
import { t, tMaybe, tView } from '../i18n.js';

/** What both production boards (FallbackBoard and BryntumBoard) receive. */
export interface BoardProps {
  rows: BoardRow[];
  dependencies: BoardDependency[];
  startDate: string;
  endDate: string;
  lang: Lang;
}

const LOCALES: Record<Lang, string> = { hi: 'hi-IN', en: 'en-US', es: 'es-ES' };

/** "10 Dec" in the viewer's language. Board dates are whole UTC days. */
export function formatDay(isoDate: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALES[lang], { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(isoDate));
}

/** A row's name in the viewer's language. The SAUDA-<id> prefix of an order shows only in judge mode. */
export function rowLabel(row: BoardRow, lang: Lang, judge: boolean): string {
  if (row.kind === 'order') return tView(lang, row.nameKey, { ...row.params, item: row.params.item ?? t(lang, 'board.noItem') }, judge);
  if (row.key === 'ship_by') return t(lang, 'board.row.ship_by', { date: formatDay(row.params.date ?? row.endDate, lang) });
  return tMaybe(lang, row.nameKey);
}

/** Sample orders start folded, so the real deal's steps are what the maker sees first. */
export const startsExpanded = (orderId: string) => !SAMPLE_ORDER_IDS.includes(orderId);
