import { depositPaid, fullyPaid, type DealView, type Lang } from '../../../shared/types.js';
import { t } from '../i18n.js';

/** The six named steps of a deal, in order. */
export const DEAL_STEPS = ['negotiate', 'confirm', 'deposit', 'making', 'balance', 'shipped'] as const;
export type DealStep = (typeof DEAL_STEPS)[number];

/** Which steps are done, from the same facts the server's phase uses (terms, confirmations, invoice, photo approval, tracking). */
export function stepsDone(view: DealView): Record<DealStep, boolean> {
  const a = view.agreement;
  const both = Boolean(view.confirmations.maker?.current && view.confirmations.buyer?.current) || view.invoice !== null || a.locked;
  return {
    negotiate: both || (a.rows.length > 0 && a.missing.length === 0 && a.errors.length === 0),
    confirm: both,
    deposit: depositPaid(view),
    making: view.progressApproval !== null || view.tracking !== null,
    balance: fullyPaid(view),
    shipped: view.tracking !== null,
  };
}

/**
 * The deal's progress bar: six segments with their names (Negotiate, Confirm, Deposit, Making,
 * Balance, Shipped). Done steps are emerald, the current one light emerald with a bold name, the
 * rest grey. Replaces the five unlabelled dots; keeps the `phase` test id and data-phase.
 */
export function DealProgress({ view, lang, className = '' }: { view: DealView; lang: Lang; className?: string }) {
  const done = stepsDone(view);
  const cancelled = view.phase === 'cancelled';
  const current = cancelled ? -1 : DEAL_STEPS.findIndex((s) => !done[s]);
  const phase = t(lang, `phase.${view.phase}`);
  const label =
    current === -1 && !cancelled
      ? t(lang, 'steps.complete')
      : cancelled
        ? phase
        : t(lang, 'steps.label', { n: current + 1, total: DEAL_STEPS.length, name: t(lang, `steps.${DEAL_STEPS[current]}`) });
  return (
    <div data-testid="phase" data-phase={view.phase} title={phase} className={`flex min-w-0 flex-col justify-center ${className}`}>
      <span className="sr-only">{label}</span>
      <ol className="flex w-full gap-1.5" aria-hidden>
        {DEAL_STEPS.map((s, i) => {
          const state = cancelled ? 'todo' : done[s] ? 'done' : i === current ? 'current' : 'todo';
          return (
            // Below lg each step is as wide as its name plus an equal share of the rest, so no name is cut on a phone.
            <li key={s} data-testid={`step-${s}`} data-state={state} className="min-w-0 flex-auto lg:flex-1">
              <span className={`block h-1.5 rounded-full transition-colors ${state === 'done' ? 'bg-emerald-600' : state === 'current' ? 'bg-emerald-200' : 'bg-stone-200'}`} />
              <span
                className={`mt-1 block truncate text-xs leading-tight ${
                  state === 'done' ? 'text-emerald-800' : state === 'current' ? 'font-semibold text-stone-900' : 'text-stone-400'
                }`}
              >
                {t(lang, `steps.${s}`)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
