import { useState } from 'react';
import type { BoardRow, BoardRowState } from '../../../shared/board.js';
import { Icon } from '../components/Icon.js';
import { t } from '../i18n.js';
import { useJudge } from '../judge.js';
import { ui } from '../ui.js';
import { formatDay, isWaitingGate, rowLabel, rowTitle, startsExpanded, type BoardProps } from './props.js';
import { StateChip } from './StateChip.js';

/**
 * The production board without Bryntum: a CSS grid with the step names on the left and a date axis
 * on the right (bars for tasks, diamonds for milestones and payment gates, a red line for the
 * ship-by date). It always ships, so Sauda works when the Bryntum package is not installed.
 */

const DAY = 86_400_000;

const BAR: Record<BoardRowState, string> = { done: 'bg-emerald-600', ready: 'bg-sky-200', locked: 'bg-stone-200' };

export function Board({ rows, startDate, endDate, lang }: BoardProps) {
  const judge = useJudge();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // One spare day on each side so the diamonds at the ends stay inside the track.
  const from = Date.parse(startDate) - DAY;
  const to = Date.parse(endDate) + DAY;
  const span = Math.max(DAY, to - from);
  const pct = (isoDate: string) => ((Date.parse(isoDate) - from) / span) * 100;

  const days = Math.round(span / DAY);
  const step = Math.max(1, Math.ceil(days / 6));
  const ticks: number[] = [];
  for (let d = 1; d < days; d += step) ticks.push(from + d * DAY);

  const expanded = (orderId: string) => open[orderId] ?? startsExpanded(orderId);
  const visible = rows.filter((r) => r.kind === 'order' || expanded(r.orderId));

  const track = (r: BoardRow) => {
    const left = pct(r.startDate);
    const title = `${rowTitle(r, lang, judge)} · ${formatDay(r.startDate, lang)}${r.endDate !== r.startDate ? `–${formatDay(r.endDate, lang)}` : ''}`;
    if (r.kind === 'order')
      return (
        <div title={title} className="absolute top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-stone-200" style={{ left: `${left}%`, width: `${pct(r.endDate) - left}%` }}>
          <div className="h-full rounded-full bg-emerald-600" style={{ width: `${r.percentDone}%` }} />
        </div>
      );
    if (r.kind === 'task')
      return (
        <div
          title={title}
          className={`absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full ${BAR[r.state]}`}
          style={{ left: `${left}%`, width: `${Math.max(1, pct(r.endDate) - left)}%` }}
        />
      );
    if (r.kind === 'deadline') return <div title={title} className="absolute inset-y-1 w-px bg-red-500" style={{ left: `${left}%` }} />;
    const size = r.kind === 'gate' ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5';
    return <div title={title} className={`absolute top-1/2 ${size} -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] ${BAR[r.state]}`} style={{ left: `${left}%` }} />;
  };

  return (
    <div data-testid="board" data-board="fallback" className="text-sm">
      <div className="grid grid-cols-[minmax(200px,300px)_minmax(0,1fr)] gap-x-3">
        <div />
        <div className="relative h-5" aria-hidden>
          {ticks.map((ms) => (
            <span key={ms} className="absolute top-0 whitespace-nowrap text-[11px] text-stone-400" style={{ left: `${((ms - from) / span) * 100}%` }}>
              {formatDay(new Date(ms).toISOString(), lang)}
            </span>
          ))}
        </div>
      </div>
      <div className="divide-y divide-stone-100">
        {visible.map((r) => {
          const locked = r.state === 'locked';
          return (
            <div
              key={r.id}
              data-testid={`board-row-${r.key}`}
              data-state={r.state}
              data-order={r.orderId}
              data-kind={r.kind}
              className="grid grid-cols-[minmax(200px,300px)_minmax(0,1fr)] items-center gap-x-3"
            >
              {r.kind === 'order' ? (
                <button
                  type="button"
                  aria-expanded={expanded(r.orderId)}
                  title={`${rowLabel(r, lang, judge)} · ${t(lang, 'board.expand')}`}
                  onClick={() => setOpen((o) => ({ ...o, [r.orderId]: !expanded(r.orderId) }))}
                  className={`${ui.btnGhost} -ml-2 min-w-0 py-1.5 text-stone-900`}
                >
                  <Icon name="chevronDown" size={14} className={`text-stone-400 transition-transform ${expanded(r.orderId) ? '' : '-rotate-90'}`} />
                  <span className="truncate">{rowLabel(r, lang, judge)}</span>
                </button>
              ) : (
                <div title={rowTitle(r, lang, judge)} className={`flex min-w-0 items-center gap-2 py-1.5 pl-5 ${locked ? 'text-stone-400' : 'text-stone-700'}`}>
                  <StateChip state={r.state} lang={lang} />
                  <span className={`truncate text-[13px] ${r.kind === 'gate' && !locked ? 'font-medium text-stone-900' : ''}`}>{rowLabel(r, lang, judge)}</span>
                </div>
              )}
              <div className="relative h-8">
                {ticks.map((ms) => (
                  <span key={ms} className="absolute inset-y-0 w-px bg-stone-100" style={{ left: `${((ms - from) / span) * 100}%` }} aria-hidden />
                ))}
                {track(r)}
                {isWaitingGate(r, rows) && (
                  <span
                    data-testid="board-waiting"
                    className="absolute top-1/2 inline-flex -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
                    style={{ left: `calc(${pct(r.startDate)}% + 14px)` }}
                  >
                    <Icon name="clock" size={12} />
                    {t(lang, 'board.waiting')}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
