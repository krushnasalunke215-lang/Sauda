import { useEffect, useRef, useState } from 'react';
import type { DealView, Lang } from '../../../shared/types.js';
import { t } from '../i18n.js';
import { ui } from '../ui.js';

/** The payment events the server posts when PayPal shows money in, and what the card calls them. */
const KINDS: Record<string, 'deposit' | 'balance' | 'full'> = { deposit_received: 'deposit', balance_received: 'balance', paid_in_full: 'full' };
const SHOW_MS = 5500;

interface Moment {
  id: string;
  kind: 'deposit' | 'balance' | 'full';
  amount: string;
}

/**
 * The payment moment: when a new payment event arrives (PayPal confirmed a deposit, the balance or
 * the full amount), a card with a check mark and the amount shows for a few seconds, worded for
 * this viewer in their language ("Deposit received" for the maker, "Deposit paid" for the buyer).
 * Events already in the deal when the page opened are history and do not show. The card never
 * takes clicks, so nothing under it is blocked.
 */
export function PaymentMoment({ view, lang }: { view: DealView; lang: Lang }) {
  const seen = useRef<Set<string> | null>(null);
  const [moment, setMoment] = useState<Moment | null>(null);

  useEffect(() => {
    const events = view.messages.filter((m) => m.event && m.event.type in KINDS);
    if (!seen.current) {
      seen.current = new Set(events.map((m) => m.id));
      return;
    }
    const fresh = events.filter((m) => !seen.current!.has(m.id));
    for (const m of fresh) seen.current.add(m.id);
    const last = fresh.at(-1);
    if (last?.event) setMoment({ id: last.id, kind: KINDS[last.event.type]!, amount: String(last.event.params.amount ?? '') });
  }, [view.messages]);

  useEffect(() => {
    if (!moment) return;
    const id = setTimeout(() => setMoment(null), SHOW_MS);
    return () => clearTimeout(id);
  }, [moment]);

  if (!moment) return null;
  const role = view.role;
  const next =
    moment.kind === 'deposit'
      ? role === 'maker'
        ? t(lang, 'moment.next.deposit.maker')
        : t(lang, 'moment.next.deposit.buyer', { name: view.parties.maker.name })
      : t(lang, 'moment.next.paid');
  return (
    <div className="pointer-events-none fixed inset-x-0 top-28 z-40 flex justify-center px-4" role="status" aria-live="polite">
      <div key={moment.id} data-testid="payment-moment" data-kind={moment.kind} className={`${ui.card} pay-moment w-full max-w-xs p-6 text-center shadow-xl`}>
        <svg viewBox="0 0 56 56" width={64} height={64} className="mx-auto" aria-hidden>
          <circle cx="28" cy="28" r="25" className="fill-emerald-50 stroke-emerald-600" strokeWidth={2.5} />
          <path d="M17 29l7.5 7.5L39.5 21" fill="none" className="pay-moment-check stroke-emerald-600" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="mt-3 text-sm font-semibold text-emerald-800">{t(lang, `moment.${moment.kind}.${role}`)}</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight text-stone-900 tabular-nums">{moment.amount}</p>
        <p className="mt-2 text-sm leading-relaxed text-stone-600">
          {t(lang, 'moment.confirmed')} {next}
        </p>
      </div>
    </div>
  );
}
