import { useRef, useState } from 'react';
import { depositPaid, fullyPaid, LANG_TAGS, type DealView, type Lang, type Message } from '../../../shared/types.js';
import { t, tMaybe } from '../i18n.js';
import { ui, useCloseOnOutside } from '../ui.js';
import { Icon } from './Icon.js';
import { QrImage } from './QrImage.js';

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Only PayPal sandbox pay pages are ever linked. */
export const isSandboxLink = (u: string) => {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && url.hostname.endsWith('.sandbox.paypal.com');
  } catch {
    return false;
  }
};

function lastEvent(messages: Message[], types: string[]): Message | undefined {
  return [...messages].reverse().find((m) => m.event && types.includes(m.event.type));
}

/** One payment milestone (deposit, balance or paid in full): a check once received, else a hollow dot. */
function Milestone({ label, amount, event, lang, testId }: { label: string; amount: string; event: Message | undefined; lang: Lang; testId: string }) {
  const received = Boolean(event);
  const date = event ? new Intl.DateTimeFormat(LANG_TAGS[lang], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.createdAt)) : '';
  return (
    <li data-testid={testId} data-state={received ? 'received' : 'pending'} className="flex items-center gap-3 py-2 text-sm">
      {received ? (
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
          <Icon name="check" size={12} />
        </span>
      ) : (
        <span className="h-5 w-5 shrink-0 rounded-full ring-2 ring-inset ring-stone-200" aria-hidden />
      )}
      <span className={`flex-1 ${received ? 'font-medium text-stone-900' : 'text-stone-600'}`}>
        {label} <span className="font-normal text-stone-500">{amount}</span>
      </span>
      <span className={`text-xs ${received ? 'text-emerald-700' : 'text-stone-400'}`}>{received ? date : t(lang, 'pay.pending')}</span>
    </li>
  );
}

/** The private-window tip, folded behind an info icon so the pay button stands alone. */
function PayTip({ lang }: { lang: Lang }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useCloseOnOutside(ref);
  const label = t(lang, 'pay.tipLabel');
  return (
    <details ref={ref} className="relative shrink-0" data-testid="pay-tip">
      <summary className={`${ui.btnIcon} ${ui.summary}`} aria-label={label} title={label}>
        <Icon name="info" size={18} />
      </summary>
      <p className={`${ui.menu} absolute right-0 top-full mt-2 w-64 p-3 text-xs leading-relaxed text-stone-600`}>{t(lang, 'pay.tip')}</p>
    </details>
  );
}

function PayLink({ url, label, qrLabel, testId, lang }: { url: string; label: string; qrLabel: string; testId: string; lang: Lang }) {
  return (
    <div className="flex items-center gap-2">
      <a data-testid={testId} href={url} target="_blank" rel="noopener noreferrer" className={`${ui.btnPayPal} flex-1`}>
        {label}
      </a>
      <PayTip lang={lang} />
      <QrImage url={url} size={64} alt={qrLabel} testId="payer-qr" />
    </div>
  );
}

/** One amount tile (paid, due, total): the label above, only the amount in the test-id element. */
function Tile({ label, cents, tone, testId }: { label: string; cents: number; tone: string; testId: string }) {
  return (
    <div className={`rounded-xl p-3 ${tone}`}>
      <dt className="text-xs font-medium opacity-80">{label}</dt>
      <dd data-testid={testId} className="mt-0.5 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl split:text-lg">
        {usd(cents)}
      </dd>
    </div>
  );
}

export function PaymentPanel({
  view,
  lang,
  onRefresh,
  onRemind,
}: {
  view: DealView;
  lang: Lang;
  onRefresh: () => Promise<boolean>;
  onRemind: () => Promise<boolean>;
}) {
  const [checking, setChecking] = useState(false);
  const inv = view.invoice;
  if (!inv) return null;
  const buyer = view.role === 'buyer';
  const buyerName = view.parties.buyer.name;
  const cancelled = inv.status === 'CANCELLED';
  const paid = fullyPaid(view);
  const deposit = depositPaid(view);
  const depositEvent = lastEvent(view.messages, ['deposit_received']);
  const balanceEvent = lastEvent(view.messages, ['balance_received']);
  // Paid in one go (the buyer changed the pre-filled deposit to the total): one row, not two.
  const fullEvent = depositEvent ? undefined : lastEvent(view.messages, ['paid_in_full']);
  const hasBalance = inv.depositCents < inv.totalCents;
  const link = isSandboxLink(inv.payerUrl) ? inv.payerUrl : null;
  const canRemind = !buyer && (inv.status === 'UNPAID' || inv.status === 'PARTIALLY_PAID');
  const reminderBusy = view.proposals.some((p) => p.tool === 'send_reminder' && (p.status === 'pending' || p.status === 'running'));
  const percent = inv.totalCents > 0 ? Math.min(100, Math.round((inv.paidCents / inv.totalCents) * 100)) : 0;

  let step: { kind: 'pay'; label: string; testId: string } | { kind: 'note'; text: string } | null = null;
  if (cancelled) step = { kind: 'note', text: t(lang, 'pay.cancelled') };
  else if (paid) step = { kind: 'note', text: t(lang, 'pay.paidInFull') };
  else if (buyer) {
    if (!deposit) step = { kind: 'pay', label: t(lang, 'pay.payDeposit', { amount: usd(inv.depositCents) }), testId: 'pay-deposit' };
    else if (view.progressApproval) step = { kind: 'pay', label: t(lang, 'pay.payBalance', { amount: usd(inv.dueCents) }), testId: 'pay-balance' };
    else step = { kind: 'note', text: t(lang, 'pay.balanceAfterPhoto') };
  } else {
    if (!deposit) step = { kind: 'note', text: t(lang, 'pay.waitDeposit', { name: buyerName }) };
    else if (!view.progressApproval) step = { kind: 'note', text: t(lang, 'pay.waitPhoto', { name: buyerName }) };
    else step = { kind: 'note', text: t(lang, 'pay.waitBalance', { name: buyerName }) };
  }

  // The status badge in the title; it only reads the invoice state and the photo approval.
  const badge: { state: string; tone: string; text: string } | null = cancelled
    ? null
    : paid
      ? { state: 'paid', tone: ui.tone.done, text: t(lang, 'phase.paid') }
      : view.progressApproval
        ? { state: 'balance_due', tone: ui.tone.action, text: t(lang, 'pay.balanceDue') }
        : deposit
          ? { state: 'deposit_paid', tone: ui.tone.done, text: t(lang, 'phase.deposit_paid') }
          : { state: 'invoiced', tone: ui.tone.pay, text: t(lang, 'phase.invoiced') };

  return (
    <section className={`${ui.card} p-5`} data-testid="payment-panel" data-status={inv.status}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className={ui.title}>{t(lang, 'pay.title')}</h2>
        {badge && (
          <span data-testid="pay-badge" data-state={badge.state} className={`${ui.pill} ${badge.tone}`}>
            {badge.state === 'paid' && <Icon name="check" size={12} />}
            {badge.text}
          </span>
        )}
        <span data-testid="invoice-number" className={`${ui.meta} ml-auto`}>
          {t(lang, 'pay.invoice', { number: inv.number })}
        </span>
      </div>

      {/* Three tiles in a row where the sidebar is wide enough, two per row in the narrow /demo sidebar. */}
      <dl className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2">
        <Tile label={t(lang, 'pay.paid')} cents={inv.paidCents} tone="bg-emerald-50 text-emerald-800" testId="invoice-paid" />
        <Tile label={t(lang, 'pay.due')} cents={inv.dueCents} tone={inv.dueCents > 0 ? 'bg-amber-50 text-amber-900' : 'bg-stone-50 text-stone-500'} testId="invoice-due" />
        <Tile label={t(lang, 'pay.total')} cents={inv.totalCents} tone="bg-stone-50 text-stone-900" testId="invoice-total" />
      </dl>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-100" aria-hidden>
        <div className="h-full rounded-full bg-emerald-600 transition-[width] duration-700" style={{ width: `${percent}%` }} />
      </div>

      <ul className="mt-3 divide-y divide-stone-100">
        {fullEvent ? (
          <Milestone label={t(lang, 'pay.full')} amount={usd(inv.totalCents)} event={fullEvent} lang={lang} testId="full-chip" />
        ) : (
          <>
            <Milestone label={t(lang, 'pay.deposit')} amount={usd(inv.depositCents)} event={depositEvent} lang={lang} testId="deposit-chip" />
            {hasBalance && <Milestone label={t(lang, 'pay.balance')} amount={usd(inv.totalCents - inv.depositCents)} event={balanceEvent} lang={lang} testId="balance-chip" />}
          </>
        )}
      </ul>

      {view.tracking && (
        <p data-testid="tracking-info" className="mt-2 flex items-center gap-2 text-sm text-stone-700">
          <Icon name="truck" className="text-stone-500" />
          {t(lang, 'pay.shipped', { carrier: tMaybe(lang, `carrier.${view.tracking.carrier}`, {}, view.tracking.carrier), number: view.tracking.number })}
        </p>
      )}

      <div className="mt-4">
        {step?.kind === 'pay' && link && <PayLink url={link} label={step.label} qrLabel={t(lang, 'pay.qr')} testId={step.testId} lang={lang} />}
        {step?.kind === 'note' && (
          <p
            data-testid="payment-step"
            className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm leading-relaxed ${paid ? 'bg-emerald-50 text-emerald-900' : 'bg-stone-50 text-stone-700'}`}
          >
            <Icon name={paid ? 'checkCircle' : 'clock'} className={`mt-0.5 ${paid ? 'text-emerald-700' : 'text-stone-400'}`} />
            {step.text}
          </p>
        )}
      </div>

      {inv.textMatches ? (
        <p data-testid="text-match" data-state="ok" className="mt-3 flex items-center gap-1.5 text-xs text-stone-500">
          <Icon name="shieldCheck" size={14} className="text-emerald-700" />
          {t(lang, 'pay.textMatches')}
        </p>
      ) : (
        <p data-testid="text-match" data-state="changed" className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
          <Icon name="alert" size={14} className="mt-px" />
          {t(lang, 'pay.textChanged')}
        </p>
      )}

      {((buyer && !paid && !cancelled) || canRemind) && (
        <div className="mt-3 flex flex-wrap gap-1 border-t border-stone-100 pt-3">
          {buyer && !paid && !cancelled && (
            <button
              type="button"
              data-testid="refresh-payment"
              disabled={checking}
              onClick={async () => {
                setChecking(true);
                await onRefresh();
                setChecking(false);
              }}
              className={ui.btnGhost}
            >
              <Icon name="refresh" className={checking ? 'animate-spin' : ''} />
              {checking ? t(lang, 'pay.checking') : t(lang, 'pay.checkNow')}
            </button>
          )}
          {canRemind && (
            <button type="button" data-testid="remind-buyer" disabled={reminderBusy} onClick={() => void onRemind()} className={ui.btnGhost}>
              <Icon name="bell" />
              {t(lang, 'pay.remind')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
