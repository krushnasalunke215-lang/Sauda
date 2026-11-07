import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { depositPaid, fullyPaid, type DealView, type Lang, type Message } from '../../../shared/types.js';
import { t, tMaybe } from '../i18n.js';

const LOCALES: Record<Lang, string> = { hi: 'hi-IN', en: 'en-US', es: 'es-ES' };
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Only PayPal sandbox pay pages are ever linked. */
const isSandboxLink = (u: string) => {
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

function Chip({ label, event, lang, testId }: { label: string; event: Message | undefined; lang: Lang; testId: string }) {
  const received = Boolean(event);
  const cents = event?.event?.params.cents;
  const amount = typeof cents === 'number' ? usd(cents) : '';
  const date = event ? new Intl.DateTimeFormat(LOCALES[lang], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.createdAt)) : '';
  return (
    <span
      data-testid={testId}
      data-state={received ? 'received' : 'pending'}
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${received ? 'bg-emerald-100 text-emerald-900' : 'bg-stone-100 text-stone-600'}`}
    >
      {label}: {received ? t(lang, 'pay.receivedOn', { amount, date }) : t(lang, 'pay.pending')}
    </span>
  );
}

function PayLink({ url, label, testId }: { url: string; label: string; testId: string }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(url, { margin: 1, width: 160 })
      .then((d) => live && setQr(d))
      .catch(() => live && setQr(null));
    return () => {
      live = false;
    };
  }, [url]);
  return (
    <div className="mt-3 flex items-start gap-3">
      <div className="flex-1">
        <a
          data-testid={testId}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg bg-[#0070ba] px-4 py-2 text-center font-semibold text-white hover:bg-[#005ea6]"
        >
          {label}
        </a>
      </div>
      {qr && <img data-testid="payer-qr" src={qr} width={80} height={80} alt="" className="rounded ring-1 ring-stone-200" />}
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
  // Paid in one go (the buyer changed the pre-filled deposit to the total): one chip, not two.
  const fullEvent = depositEvent ? undefined : lastEvent(view.messages, ['paid_in_full']);
  const hasBalance = inv.depositCents < inv.totalCents;
  const link = isSandboxLink(inv.payerUrl) ? inv.payerUrl : null;
  const canRemind = !buyer && (inv.status === 'UNPAID' || inv.status === 'PARTIALLY_PAID');
  const reminderBusy = view.proposals.some((p) => p.tool === 'send_reminder' && (p.status === 'pending' || p.status === 'running'));

  let step: { kind: 'pay'; label: string; testId: string } | { kind: 'note'; text: string } | null = null;
  if (cancelled) step = { kind: 'note', text: t(lang, 'pay.cancelled') };
  else if (paid) step = { kind: 'note', text: t(lang, 'pay.paidInFull') };
  else if (buyer) {
    if (!deposit) step = { kind: 'pay', label: t(lang, 'pay.payDeposit'), testId: 'pay-deposit' };
    else if (view.progressApproval) step = { kind: 'pay', label: t(lang, 'pay.payBalance'), testId: 'pay-balance' };
    else step = { kind: 'note', text: t(lang, 'pay.balanceAfterPhoto') };
  } else {
    if (!deposit) step = { kind: 'note', text: t(lang, 'pay.waitDeposit', { name: buyerName }) };
    else if (!view.progressApproval) step = { kind: 'note', text: t(lang, 'pay.waitPhoto', { name: buyerName }) };
    else step = { kind: 'note', text: t(lang, 'pay.waitBalance', { name: buyerName }) };
  }

  return (
    <section className="rounded-xl border border-sky-200 bg-white p-4" data-testid="payment-panel" data-status={inv.status}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-stone-600">{t(lang, 'pay.title')}</h2>
        <span data-testid="invoice-number" className="text-xs text-stone-500">
          {t(lang, 'pay.invoice', { number: inv.number })} · {inv.status}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded bg-stone-50 p-2">
          <dt className="text-xs text-stone-500">{t(lang, 'pay.total')}</dt>
          <dd data-testid="invoice-total" className="font-semibold">{usd(inv.totalCents)}</dd>
        </div>
        <div className="rounded bg-stone-50 p-2">
          <dt className="text-xs text-stone-500">{t(lang, 'pay.paid')}</dt>
          <dd data-testid="invoice-paid" className="font-semibold text-emerald-800">{usd(inv.paidCents)}</dd>
        </div>
        <div className="rounded bg-stone-50 p-2">
          <dt className="text-xs text-stone-500">{t(lang, 'pay.due')}</dt>
          <dd data-testid="invoice-due" className="font-semibold">{usd(inv.dueCents)}</dd>
        </div>
      </dl>
      <div className="mt-2 flex flex-wrap gap-2">
        {fullEvent ? (
          <Chip label={`${t(lang, 'pay.full')} ${usd(inv.totalCents)}`} event={fullEvent} lang={lang} testId="full-chip" />
        ) : (
          <>
            <Chip label={`${t(lang, 'pay.deposit')} ${usd(inv.depositCents)}`} event={depositEvent} lang={lang} testId="deposit-chip" />
            {hasBalance && <Chip label={`${t(lang, 'pay.balance')} ${usd(inv.totalCents - inv.depositCents)}`} event={balanceEvent} lang={lang} testId="balance-chip" />}
          </>
        )}
      </div>
      {inv.textMatches ? (
        <p data-testid="text-match" data-state="ok" className="mt-2 text-xs text-emerald-800">
          {t(lang, 'pay.textMatches')}
        </p>
      ) : (
        <p data-testid="text-match" data-state="changed" className="mt-2 rounded bg-red-50 p-2 text-xs font-medium text-red-800">
          {t(lang, 'pay.textChanged')}
        </p>
      )}
      {view.tracking && (
        <p data-testid="tracking-info" className="mt-2 text-xs text-violet-800">
          {t(lang, 'pay.shipped', { carrier: tMaybe(lang, `carrier.${view.tracking.carrier}`, {}, view.tracking.carrier), number: view.tracking.number })}
        </p>
      )}

      {step?.kind === 'pay' && link && (
        <>
          <PayLink url={link} label={step.label} testId={step.testId} />
          <p className="mt-2 text-xs text-stone-500">{t(lang, 'pay.tip')}</p>
        </>
      )}
      {step?.kind === 'note' && (
        <p data-testid="payment-step" className="mt-3 text-sm text-stone-700">
          {step.text}
        </p>
      )}

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
          className="mt-2 w-full rounded-lg border border-sky-300 px-3 py-1.5 text-sm text-sky-900 hover:bg-sky-50 disabled:opacity-50"
        >
          {checking ? t(lang, 'pay.checking') : t(lang, 'pay.checkNow')}
        </button>
      )}
      {canRemind && (
        <button
          type="button"
          data-testid="remind-buyer"
          disabled={reminderBusy}
          onClick={() => void onRemind()}
          className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-800 hover:bg-stone-50 disabled:opacity-50"
        >
          {t(lang, 'pay.remind')}
        </button>
      )}
    </section>
  );
}
