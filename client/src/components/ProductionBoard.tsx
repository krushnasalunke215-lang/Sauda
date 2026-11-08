import { lazy, Suspense, useMemo } from 'react';
import { buildBoard, mergeBoards, sampleOrders } from '../../../shared/board.js';
import type { DealView, Lang } from '../../../shared/types.js';
import { t } from '../i18n.js';
import { ui } from '../ui.js';

// The board (Bryntum Gantt or the fallback, picked at build time) loads in its own chunk on first open,
// so pages without the board never download Bryntum or its CSS.
const Board = lazy(() => import('virtual:sauda-board').then((m) => ({ default: m.Board })));

/** The maker's production board: this deal plus two sample orders, rebuilt from every DealView snapshot. */
export function ProductionBoard({ view, lang }: { view: DealView; lang: Lang }) {
  const board = useMemo(() => mergeBoards([buildBoard(view), ...sampleOrders(new Date(), lang).map(buildBoard)]), [view, lang]);
  return (
    <section className={`${ui.card} p-5`} data-testid="production-board">
      <h2 className={ui.title}>{t(lang, 'board.title')}</h2>
      <p className={`${ui.meta} mt-1`}>{t(lang, 'board.subtitle')}</p>
      <div className="mt-4">
        <Suspense fallback={<p className={`${ui.meta} animate-pulse py-8 text-center`}>{t(lang, 'board.loading')}</p>}>
          <Board rows={board.rows} dependencies={board.dependencies} startDate={board.startDate} endDate={board.endDate} lang={lang} />
        </Suspense>
      </div>
    </section>
  );
}
