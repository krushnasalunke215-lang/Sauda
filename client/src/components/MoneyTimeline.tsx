import type { DealView, Lang, TimelineEntry } from '../../../shared/types.js';
import { t, tMaybe } from '../i18n.js';

const LOCALES: Record<Lang, string> = { hi: 'hi-IN', en: 'en-US', es: 'es-ES' };
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function Row({ e, lang }: { e: TimelineEntry; lang: Lang }) {
  const time = new Intl.DateTimeFormat(LOCALES[lang], { timeStyle: 'medium' }).format(new Date(e.at));
  const base = 'border-l-2 py-1.5 pl-3 text-xs';
  const head = (label: string) => (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-[10px] text-stone-400">{time}</span>
      <span className="font-medium text-stone-800">{label}</span>
    </div>
  );
  switch (e.type) {
    case 'paypal_call': {
      const ok = e.status !== null && e.status >= 200 && e.status < 300;
      const failed = Boolean(e.error) || (e.status !== null && e.status >= 400);
      return (
        <li data-testid="timeline-entry" data-type={e.type} data-label={e.label} data-debug={e.debugId ?? ''} className={`${base} ${failed ? 'border-red-400' : ok ? 'border-sky-300' : 'border-stone-300'}`}>
          {head(e.label)}
          <div className="font-mono text-[11px] text-stone-600">
            <span className="font-semibold">{e.method}</span> {e.path}
          </div>
          <div className="flex flex-wrap gap-x-3 text-[11px] text-stone-500">
            <span>HTTP {e.status ?? (e.error ? '—' : 'OK')}</span>
            <span data-testid="timeline-debug">
              {t(lang, 'timeline.debug')}: <code className="text-stone-700">{e.debugId ?? '—'}</code>
            </span>
            <span>{e.ms} ms</span>
          </div>
          {e.error && <div className="text-[11px] text-red-700">{e.error}</div>}
        </li>
      );
    }
    case 'webhook':
      return (
        <li data-testid="timeline-entry" data-type={e.type} className={`${base} border-violet-300`}>
          {head(`${t(lang, 'timeline.webhook')} ${e.eventType}`)}
          <div className="text-[11px] text-stone-600">
            <code>{e.eventId}</code> · {e.verified ? t(lang, 'timeline.verified') : t(lang, 'timeline.notVerified')}
            {e.invoiceStatus ? ` · ${e.invoiceStatus}` : ''}
          </div>
        </li>
      );
    case 'poll_change':
      return (
        <li data-testid="timeline-entry" data-type={e.type} data-to={e.to} className={`${base} border-emerald-300`}>
          {head(t(lang, 'timeline.status', { from: e.from ?? '—', to: e.to, paid: usd(e.paidCents), source: tMaybe(lang, `timeline.source.${e.source}`, {}, e.source) }))}
          {e.debugId && (
            <div className="text-[11px] text-stone-500">
              {t(lang, 'timeline.debug')}: <code className="text-stone-700">{e.debugId}</code>
            </div>
          )}
        </li>
      );
    case 'payment':
      return (
        <li data-testid="timeline-entry" data-type={e.type} data-kind={e.kind} className={`${base} border-emerald-500 bg-emerald-50/50`}>
          {head(`${t(lang, `timeline.payment.${e.kind}`)} ${usd(e.cents)}`)}
          <div className="text-[11px] text-stone-600">
            <code>{e.txnId}</code> · {e.method}
            {e.method !== 'PAYPAL' && <span className="text-amber-800"> · {t(lang, 'timeline.recorded')}</span>}
          </div>
        </li>
      );
    case 'tracking':
      return (
        <li data-testid="timeline-entry" data-type={e.type} className={`${base} border-violet-500`}>
          {head(t(lang, 'timeline.tracking', { carrier: e.carrier, number: e.trackingNumber, status: e.status }))}
          <div className="text-[11px] text-stone-600">{e.txnIds.join(', ')}</div>
        </li>
      );
    case 'alert':
      return (
        <li data-testid="timeline-entry" data-type={e.type} className={`${base} border-red-600 bg-red-50 text-red-800`}>
          {head(tMaybe(lang, `timeline.alert.${e.code}`, e.params, e.code))}
        </li>
      );
  }
}

/** Every PayPal call, status change, payment, webhook and tracking entry of the deal, newest first. */
export function MoneyTimeline({ view, lang }: { view: DealView; lang: Lang }) {
  const entries = [...view.timeline].reverse();
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4" data-testid="timeline">
      <h2 className="text-sm font-semibold text-stone-600">{t(lang, 'timeline.title')}</h2>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">{t(lang, 'timeline.empty')}</p>
      ) : (
        <ol className="mt-2 space-y-1">
          {entries.map((e) => (
            <Row key={e.id} e={e} lang={lang} />
          ))}
        </ol>
      )}
    </section>
  );
}
