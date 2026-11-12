import type { DealView, Lang } from '../../../shared/types.js';
import { t } from '../i18n.js';
import type { NextAction } from '../nextAction.js';
import { ui } from '../ui.js';
import { Icon } from './Icon.js';

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function actionText(action: Exclude<NextAction, { kind: 'waiting' }>, lang: Lang): string {
  if (action.kind === 'payDeposit') return t(lang, 'turn.payDeposit', { amount: usd(action.cents) });
  if (action.kind === 'payBalance') return t(lang, 'turn.payBalance', { amount: usd(action.cents) });
  return t(lang, `turn.${action.kind}`);
}

/**
 * The "Your turn" line: the one next step in amber when it is mine, a quiet line when the other
 * side has to move. Text only, never a button, so no card gets a second filled button.
 */
export function YourTurn({ view, lang, action }: { view: DealView; lang: Lang; action: NextAction | null }) {
  if (!action) return null;
  if (action.kind === 'waiting')
    return (
      <p data-testid="your-turn" data-action="waiting" className="flex shrink-0 items-center gap-2 rounded-xl bg-stone-100 px-3 py-2 text-sm text-stone-600">
        <Icon name="clock" className="text-stone-400" />
        {t(lang, 'turn.waiting', { name: view.parties[action.who].name })}
      </p>
    );
  return (
    <p data-testid="your-turn" data-action={action.kind} className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1 ring-amber-200 ${ui.tone.action}`}>
      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
      <span className="font-semibold">{t(lang, 'turn.label')}</span>
      <span className="text-amber-800" aria-hidden>
        ·
      </span>
      <span className="min-w-0">{actionText(action, lang)}</span>
    </p>
  );
}

/** The buyer's sticky pay bar on a phone (above the composer) while a payment is due and the Pay tab is not open. */
export function PayBar({ url, label }: { url: string; label: string }) {
  return (
    <div className="px-3 pt-2.5">
      <a data-testid="pay-bar" href={url} target="_blank" rel="noopener noreferrer" className={ui.btnPayPal}>
        {label}
      </a>
    </div>
  );
}
