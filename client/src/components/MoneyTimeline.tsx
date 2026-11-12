import type { ReactNode } from 'react';
import { LANG_TAGS, type DealView, type Lang, type TimelineEntry } from '../../../shared/types.js';
import { t, tMaybe } from '../i18n.js';
import { ui } from '../ui.js';

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

type Tone = 'call' | 'fail' | 'money' | 'status' | 'webhook' | 'ship' | 'alert';
const DOT: Record<Tone, string> = {
  call: 'bg-stone-300',
  fail: 'bg-red-500',
  money: 'bg-emerald-600',
  status: 'bg-emerald-300',
  webhook: 'bg-violet-400',
  ship: 'bg-violet-600',
  alert: 'bg-red-600',
};

/** One timeline row: a dot on the rail, the title with its time, and quiet technical details below. */
function Item({ tone, time, title, attrs, children }: { tone: Tone; time: string; title: string; attrs: Record<string, string>; children?: ReactNode }) {
  const strong = tone === 'money' || tone === 'ship' || tone === 'alert' || tone === 'fail';
  return (
    <li data-testid="timeline-entry" {...attrs} className="relative pb-4 pl-6 last:pb-0">
      <span className="absolute top-1.5 left-0 h-2.5 w-2.5 rounded-full ring-4 ring-white" aria-hidden>
        <span className={`block h-full w-full rounded-full ${DOT[tone]}`} />
      </span>
      <div className="flex items-baseline gap-3">
        <span className={`flex-1 text-sm ${strong ? 'font-semibold' : 'font-medium'} ${tone === 'alert' || tone === 'fail' ? 'text-red-800' : 'text-stone-900'}`}>{title}</span>
        <span className="shrink-0 font-mono text-[11px] text-stone-400 tabular-nums">{time}</span>
      </div>
      {children && <div className="mt-0.5 space-y-0.5 text-xs text-stone-500">{children}</div>}
    </li>
  );
}

function Row({ e, lang }: { e: TimelineEntry; lang: Lang }) {
  const time = new Intl.DateTimeFormat(LANG_TAGS[lang], { timeStyle: 'medium' }).format(new Date(e.at));
  switch (e.type) {
    case 'paypal_call': {
      const failed = Boolean(e.error) || (e.status !== null && e.status >= 400);
      return (
        <Item tone={failed ? 'fail' : 'call'} time={time} title={e.label} attrs={{ 'data-type': e.type, 'data-label': e.label, 'data-debug': e.debugId ?? '' }}>
          <div className="font-mono text-[11px] text-stone-500">
            <span className="font-semibold text-stone-600">{e.method}</span> {e.path}
          </div>
          <div className="flex flex-wrap gap-x-3 font-mono text-[11px] text-stone-400">
            <span>HTTP {e.status ?? (e.error ? '—' : 'OK')}</span>
            <span data-testid="timeline-debug">
              {t(lang, 'timeline.debug')} <span className="text-stone-600">{e.debugId ?? '—'}</span>
            </span>
            <span>{e.ms} ms</span>
          </div>
          {e.error && <div className="text-red-700">{e.error}</div>}
        </Item>
      );
    }
    case 'webhook':
      return (
        <Item tone="webhook" time={time} title={`${t(lang, 'timeline.webhook')} ${e.eventType}`} attrs={{ 'data-type': e.type }}>
          <div className="font-mono text-[11px]">
            {e.eventId} · {e.verified ? t(lang, 'timeline.verified') : t(lang, 'timeline.notVerified')}
            {e.invoiceStatus ? ` · ${e.invoiceStatus}` : ''}
          </div>
        </Item>
      );
    case 'poll_change':
      return (
        <Item
          tone="status"
          time={time}
          title={t(lang, 'timeline.status', { from: e.from ?? '—', to: e.to, paid: usd(e.paidCents), source: tMaybe(lang, `timeline.source.${e.source}`, {}, e.source) })}
          attrs={{ 'data-type': e.type, 'data-to': e.to }}
        >
          {e.debugId && (
            <div className="font-mono text-[11px] text-stone-400">
              {t(lang, 'timeline.debug')} <span className="text-stone-600">{e.debugId}</span>
            </div>
          )}
        </Item>
      );
    case 'payment':
      return (
        <Item tone="money" time={time} title={`${t(lang, `timeline.payment.${e.kind}`)} ${usd(e.cents)}`} attrs={{ 'data-type': e.type, 'data-kind': e.kind }}>
          <div>
            <span className="font-mono text-[11px]">{e.txnId}</span> · {e.method}
            {e.method !== 'PAYPAL' && <span className="text-amber-700"> · {t(lang, 'timeline.recorded')}</span>}
          </div>
        </Item>
      );
    case 'tracking':
      return (
        <Item tone="ship" time={time} title={t(lang, 'timeline.tracking', { carrier: e.carrier, number: e.trackingNumber, status: e.status })} attrs={{ 'data-type': e.type }}>
          <div className="font-mono text-[11px]">{e.txnIds.join(', ')}</div>
        </Item>
      );
    case 'alert':
      return <Item tone="alert" time={time} title={tMaybe(lang, `timeline.alert.${e.code}`, e.params, e.code)} attrs={{ 'data-type': e.type }} />;
  }
}

/** Every PayPal call, status change, payment, webhook and tracking entry of the deal, newest first. */
export function MoneyTimeline({ view, lang }: { view: DealView; lang: Lang }) {
  const entries = [...view.timeline].reverse();
  return (
    <section className={`${ui.card} p-5`} data-testid="timeline">
      <h2 className={ui.title}>{t(lang, 'timeline.title')}</h2>
      {entries.length === 0 ? (
        <p className="mt-3 rounded-xl bg-stone-50 px-4 py-3 text-sm leading-relaxed text-stone-500">{t(lang, 'timeline.empty')}</p>
      ) : (
        <div className="relative mt-4">
          <span className="absolute top-2 bottom-2 left-[4.5px] w-px bg-stone-200" aria-hidden />
          <ol className="relative">
            {entries.map((e) => (
              <Row key={e.id} e={e} lang={lang} />
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
