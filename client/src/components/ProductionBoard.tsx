import { lazy, Suspense, useMemo } from 'react';
import { buildBoard, mergeBoards, sampleOrders } from '../../../shared/board.js';
import type { DealView, Lang } from '../../../shared/types.js';
import { t } from '../i18n.js';
import { ui } from '../ui.js';
import { Icon } from './Icon.js';

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

/** The three row states, drawn as on the board (and the payment milestones). */
function Legend({ lang }: { lang: Lang }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500" data-testid="board-legend">
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-600 text-white">
          <Icon name="check" size={9} />
        </span>
        {t(lang, 'board.state.done')}
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="h-3.5 w-3.5 rounded-full ring-2 ring-inset ring-emerald-600" />
        {t(lang, 'board.state.ready')}
      </li>
      <li className="inline-flex items-center gap-1.5">
        <Icon name="lock" size={14} className="text-stone-400" />
        {t(lang, 'board.state.locked')}
      </li>
    </ul>
  );
}

/** The maker's production board: this deal plus two sample orders, rebuilt from every DealView snapshot. */
export function ProductionBoard({ view, lang }: { view: DealView; lang: Lang }) {
  const board = useMemo(() => mergeBoards([buildBoard(view), ...sampleOrders(new Date(), lang).map(buildBoard)]), [view, lang]);
  return (
    <section className={`${ui.card} p-5`} data-testid="production-board">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className={ui.title}>{t(lang, 'board.title')}</h2>
          <p className={`${ui.meta} mt-1 max-w-md leading-relaxed`}>{t(lang, 'board.subtitle')}</p>
        </div>
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
