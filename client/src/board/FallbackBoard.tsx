import { useState } from 'react';
import type { BoardRow, BoardRowState } from '../../../shared/board.js';
import type { Lang } from '../../../shared/types.js';
import { Icon } from '../components/Icon.js';
import { t } from '../i18n.js';
import { useJudge } from '../judge.js';
import { ui } from '../ui.js';
import { formatDay, rowLabel, startsExpanded, type BoardProps } from './props.js';

/**
 * The production board without Bryntum: a CSS grid with the step names on the left and a date axis
 * on the right (bars for tasks, diamonds for milestones and payment gates, a red line for the
 * ship-by date). It always ships, so Sauda works when the Bryntum package is not installed.
 */

const DAY = 86_400_000;

const BAR: Record<BoardRowState, string> = { done: 'bg-emerald-600', ready: 'bg-emerald-200', locked: 'bg-stone-200' };

/** Done: emerald check circle. Ready: hollow emerald ring. Locked: a grey lock (as in the payment panel). */
function StateMark({ state, lang }: { state: BoardRowState; lang: Lang }) {
  const label = t(lang, `board.state.${state}`);
  if (state === 'done')
    return (
      <span title={label} className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
        <Icon name="check" size={10} />
      </span>
    );
  if (state === 'ready') return <span title={label} className="h-4 w-4 shrink-0 rounded-full ring-2 ring-inset ring-emerald-600" />;
  return (
    <span title={label} className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
      <Icon name="lock" size={14} className="text-stone-400" />
    </span>
  );
}

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
    const title = `${rowLabel(r, lang, judge)} · ${formatDay(r.startDate, lang)}${r.endDate !== r.startDate ? `–${formatDay(r.endDate, lang)}` : ''} · ${t(lang, `board.state.${r.state}`)}`;
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
      <div className="grid grid-cols-[minmax(160px,250px)_minmax(0,1fr)] gap-x-3">
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
              className="grid grid-cols-[minmax(160px,250px)_minmax(0,1fr)] items-center gap-x-3"
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
                <div className={`flex min-w-0 items-center gap-2 py-1.5 pl-5 ${locked ? 'text-stone-400' : 'text-stone-700'}`}>
                  <StateMark state={r.state} lang={lang} />
                  <span className={`truncate text-[13px] ${r.kind === 'gate' && !locked ? 'font-medium text-stone-900' : ''}`}>{rowLabel(r, lang, judge)}</span>
                </div>
              )}
              <div className="relative h-8">
                {ticks.map((ms) => (
                  <span key={ms} className="absolute inset-y-0 w-px bg-stone-100" style={{ left: `${((ms - from) / span) * 100}%` }} aria-hidden />
                ))}
                {track(r)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
