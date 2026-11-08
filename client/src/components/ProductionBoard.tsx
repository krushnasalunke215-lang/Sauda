import { useMemo } from 'react';
import { Board } from 'virtual:sauda-board';
import { buildBoard, mergeBoards, sampleOrders } from '../../../shared/board.js';
import type { DealView, Lang } from '../../../shared/types.js';
import { t } from '../i18n.js';
import { ui } from '../ui.js';

/** The maker's production board: this deal plus two sample orders, rebuilt from every DealView snapshot. */
export function ProductionBoard({ view, lang }: { view: DealView; lang: Lang }) {
  const board = useMemo(() => mergeBoards([buildBoard(view), ...sampleOrders(new Date(), lang).map(buildBoard)]), [view, lang]);
  return (
    <section className={`${ui.card} p-5`} data-testid="production-board">
      <h2 className={ui.title}>{t(lang, 'board.title')}</h2>
      <p className={`${ui.meta} mt-1`}>{t(lang, 'board.subtitle')}</p>
      <div className="mt-4">
        <Board rows={board.rows} dependencies={board.dependencies} startDate={board.startDate} endDate={board.endDate} lang={lang} />
      </div>
    </section>
  );
}
