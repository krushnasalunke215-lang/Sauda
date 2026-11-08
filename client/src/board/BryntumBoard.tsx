/**
 * The production board on Bryntum Gantt (Community tier, MIT). Used only when the package is
 * installed (npm run bryntum:install); vite.config.ts resolves 'virtual:sauda-board' to this file
 * then, and to FallbackBoard.tsx otherwise. Read-only: the rows come from shared/board.ts, so the
 * payment gates (deposit paid, balance paid) and the locks behind them are decided by code from
 * PayPal's invoice state, never by dragging bars.
 * Type-checked by `npm run typecheck:bryntum` (tsconfig.bryntum.json), not by `npm run typecheck`.
 */
import '@bryntum/core-community/fontawesome/css/fontawesome.css';
import '@bryntum/core-community/fontawesome/css/solid.css';
import '@bryntum/gantt-community/gantt.css';
import '@bryntum/gantt-community/svalbard-light.css';
import '@bryntum/gantt-community/locales/gantt.locale.Hi.js';
import '@bryntum/gantt-community/locales/gantt.locale.Es.js';
import { LocaleManager, StringHelper } from '@bryntum/core-community';
import { Gantt } from '@bryntum/gantt-community';
import { useEffect, useRef } from 'react';
import type { BoardRow } from '../../../shared/board.js';
import type { Lang } from '../../../shared/types.js';
import { t } from '../i18n.js';
import { useJudge } from '../judge.js';
import { formatDay, isWaitingGate, rowLabel, rowTitle, startsExpanded, type BoardProps } from './props.js';

const DAY = 86_400_000;
const BRYNTUM_LOCALE: Record<Lang, string> = { en: 'En', hi: 'Hi', es: 'Es' };

/** CSS classes for a row's bar or diamond (styled in styles.css). */
function taskCls(r: BoardRow, rows: BoardRow[]): string {
  return [`sauda-${r.state}`, r.kind === 'gate' && 'sauda-gate', r.kind === 'deadline' && 'sauda-deadline', isWaitingGate(r, rows) && 'sauda-waiting-gate']
    .filter(Boolean)
    .join(' ');
}

/** Bryntum task data: the order rows with their steps nested, all manually scheduled at the dates code computed. */
function toTasks(rows: BoardRow[], lang: Lang, judge: boolean) {
  const child = (r: BoardRow) => ({
    id: r.id,
    name: rowLabel(r, lang, judge),
    startDate: new Date(r.startDate),
    endDate: new Date(r.endDate),
    manuallyScheduled: true,
    cls: taskCls(r, rows),
    // Tree icons as in the payment panel: done = check circle, ready = hollow ring, locked = lock.
    ...(r.kind === 'order' ? {} : { iconCls: { done: 'fa fa-circle-check sauda-icon-done', ready: 'sauda-icon-ready', locked: 'fa fa-lock sauda-icon-locked' }[r.state] }),
  });
  return rows
    .filter((r) => r.kind === 'order')
    .map((o) => ({
      ...child(o),
      expanded: startsExpanded(o.orderId),
      children: rows.filter((r) => r.parentId === o.id).map(child),
    }));
}

/** A stable key of everything drawn: the Gantt is rebuilt only when it changes (payment events, language, judge mode). */
const boardKey = (p: BoardProps, judge: boolean) =>
  JSON.stringify([p.lang, judge, p.startDate, p.endDate, p.rows.map((r) => [r.id, r.state, r.startDate, r.endDate, r.blockedBy ?? '', r.params])]);

export function Board(props: BoardProps) {
  const judge = useJudge();
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const key = boardKey(props, judge);

  useEffect(() => {
    const { rows, dependencies, startDate, endDate, lang } = latest.current;
    if (!container.current) return;
    try {
      void LocaleManager.applyLocale(BRYNTUM_LOCALE[lang]);
    } catch {
      // Unknown locale: Bryntum keeps English for its own labels (the time axis).
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const gantt = new Gantt({
      appendTo: container.current,
      height: '100%',
      readOnly: true,
      viewPreset: 'weekAndDayLetter',
      rowHeight: 36,
      barMargin: 9,
      startDate: new Date(Date.parse(startDate) - 2 * DAY),
      endDate: new Date(Date.parse(endDate) + 3 * DAY),
      columns: [
        {
          type: 'name',
          width: 300,
          renderer: ({ record }: { record: { id: string | number } }) => {
            const r = byId.get(String(record.id));
            if (!r) return '';
            return {
              tag: 'span',
              className: `sauda-name sauda-name-${r.state}${r.kind === 'order' ? ' sauda-name-order' : ''}`,
              dataset: { testid: `board-row-${r.key}`, state: r.state, order: r.orderId, kind: r.kind },
              title: rowTitle(r, lang, judge),
              children: [
                { tag: 'span', className: 'sauda-name-text', text: rowLabel(r, lang, judge) },
                isWaitingGate(r, rows) ? { tag: 'span', className: 'sauda-waiting', dataset: { testid: 'board-waiting' }, text: t(lang, 'board.waiting') } : null,
              ].filter(Boolean),
            };
          },
        },
      ],
      features: {
        taskTooltip: {
          template: ({ taskRecord }: { taskRecord: { id: string | number } }) => {
            const r = byId.get(String(taskRecord.id));
            if (!r) return '';
            const dates = r.endDate !== r.startDate ? `${formatDay(r.startDate, lang)} – ${formatDay(r.endDate, lang)}` : formatDay(r.startDate, lang);
            return `<div class="sauda-tip">${StringHelper.encodeHtml(rowTitle(r, lang, judge))}<br>${StringHelper.encodeHtml(dates)}</div>`;
          },
        },
        taskMenu: false,
        cellMenu: false,
        headerMenu: false,
        scheduleMenu: false,
        timeAxisHeaderMenu: false,
        taskDrag: false,
        taskResize: false,
        taskDragCreate: false,
        cellEdit: false,
      },
      project: {
        startDate: new Date(startDate),
        tasks: toTasks(rows, lang, judge),
        dependencies: dependencies.map((d, i) => ({ id: i + 1, from: d.from, to: d.to })),
      },
    });
    // Show the whole plan (the earliest sample order to the latest ship-by date) without scrolling.
    let live = true;
    // (after the first render; the Community project model has no commitAsync()).
    const fit = setTimeout(() => {
      if (live && !gantt.isDestroyed) gantt.zoomToFit({ leftMargin: 16, rightMargin: 24 });
    }, 50);
    return () => {
      live = false;
      clearTimeout(fit);
      gantt.destroy();
    };
  }, [key]);

  // Bryntum sizes itself to its container, so the container has an explicit height.
  return <div ref={container} data-testid="board" data-board="bryntum" className="sauda-bryntum h-[520px] overflow-hidden rounded-xl ring-1 ring-stone-200" />;
}
