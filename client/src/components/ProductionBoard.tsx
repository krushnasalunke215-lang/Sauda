import { lazy, Suspense, useMemo } from 'react';
import { buildBoard, mergeBoards, sampleOrders } from '../../../shared/board.js';
import type { DealView, Lang } from '../../../shared/types.js';
import { t } from '../i18n.js';
import { StateChip } from '../board/StateChip.js';
import { ui } from '../ui.js';

// The board (Bryntum Gantt or the fallback, picked at build time) loads in its own chunk on first open,
// so pages without the board never download Bryntum or its CSS.
const Board = lazy(() => import('virtual:sauda-board').then((m) => ({ default: m.Board })));

/** Grey rows in the shape of the board while its chunk loads. */
function BoardSkeleton({ lang }: { lang: Lang }) {
  return (
    <div data-testid="board-loading" aria-busy="true" className="space-y-3 py-2">
      <span className="sr-only">{t(lang, 'board.loading')}</span>
      {[60, 45, 70, 35, 55, 40, 50].map((w, i) => (
        <div key={i} className="grid grid-cols-[minmax(160px,250px)_minmax(0,1fr)] items-center gap-3">
          <div className={`${ui.skeleton} h-3.5 rounded-full`} style={{ width: `${w + 30}%` }} />
          <div className={`${ui.skeleton} h-2.5 rounded-full`} style={{ marginLeft: `${i * 8}%`, width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

/** The three row states, drawn with the same chips as the board rows. */
function Legend({ lang }: { lang: Lang }) {
  return (
    <ul className="flex flex-wrap items-center gap-1.5" data-testid="board-legend">
      {(['done', 'ready', 'locked'] as const).map((s) => (
        <li key={s}>
          <StateChip state={s} lang={lang} />
        </li>
      ))}
    </ul>
  );
}

/** The maker's production board: this deal plus two sample orders, rebuilt from every DealView snapshot. */
export function ProductionBoard({ view, lang }: { view: DealView; lang: Lang }) {
  const board = useMemo(() => mergeBoards([buildBoard(view), ...sampleOrders(new Date(), lang).map(buildBoard)]), [view, lang]);
  return (
    <section className={`${ui.card} p-5`} data-testid="production-board">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className={ui.title}>{t(lang, 'board.title')}</h2>
        <Legend lang={lang} />
      </div>
      <div className="mt-4">
        <Suspense fallback={<BoardSkeleton lang={lang} />}>
          <Board rows={board.rows} dependencies={board.dependencies} startDate={board.startDate} endDate={board.endDate} lang={lang} />
        </Suspense>
      </div>
    </section>
  );
}
