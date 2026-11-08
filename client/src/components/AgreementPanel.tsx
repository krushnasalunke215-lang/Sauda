import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AgreementRow, AgreementRowField, DealView, Lang } from '../../../shared/types.js';
import { renderIssue, t } from '../i18n.js';
import { useJudge } from '../judge.js';
import { ui } from '../ui.js';
import { Icon, type IconName } from './Icon.js';

/**
 * Links a term to the message it came from: a click scrolls to that message and highlights it.
 * The normal view shows a small message icon; judge mode shows the message number (#seq).
 */
export function CiteChip({ seq, lang, onCite }: { seq: number; lang: Lang; onCite: (seq: number) => void }) {
  const judge = useJudge();
  const label = t(lang, 'agreement.cite');
  return (
    <button
      type="button"
      data-testid="citation"
      data-seq={seq}
      title={label}
      aria-label={label}
      onClick={() => onCite(seq)}
      className={`shrink-0 rounded-md text-stone-400 transition-colors hover:bg-amber-50 hover:text-amber-800 ${judge ? 'px-1.5 py-0.5 font-mono text-[11px]' : 'p-1 text-stone-300'}`}
    >
      {judge ? `#${seq}` : <Icon name="message" size={14} />}
    </button>
  );
}

type Group = 'what' | 'money' | 'delivery';
const GROUPS: { key: Group; icon: IconName; fields: AgreementRowField[] }[] = [
  { key: 'what', icon: 'tag', fields: ['item', 'quantity', 'size', 'color', 'measurement'] },
  { key: 'money', icon: 'wallet', fields: ['price', 'deposit', 'balance'] },
  { key: 'delivery', icon: 'truck', fields: ['delivery', 'shipping'] },
];

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** One compact line in the viewer's language: the strong part and the rest. Empty when nothing is agreed in the group. */
function lineText(group: Group, rows: AgreementRow[], view: DealView, lang: Lang): { lead: string; rest: string } {
  const value = (f: AgreementRowField) => rows.find((r) => r.field === f)?.value;
  if (group === 'what') {
    const qty = value('quantity');
    const parts = [
      qty && qty !== '1' ? `× ${qty}` : undefined,
      value('size'),
      value('color'),
      ...rows.filter((r) => r.field === 'measurement').map((r) => `${r.label ?? t(lang, 'field.measurement')} ${r.value}`),
    ].filter(Boolean);
    const lead = value('item') ?? parts.shift() ?? '';
    return { lead, rest: parts.join(' · ') };
  }
  if (group === 'money') {
    const d = view.agreement.derived;
    const usdOk = d.currency === 'USD';
    const deposit = value('deposit') && (usdOk && d.depositCents !== null ? `${usd(d.depositCents)}${d.depositPercent !== null ? ` (${d.depositPercent}%)` : ''}` : value('deposit'));
    const balance = value('balance');
    const parts = [deposit && `${t(lang, 'field.deposit')} ${deposit}`, balance && `${t(lang, 'field.balance')} ${balance}`].filter(Boolean);
    const lead = value('price') ?? parts.shift() ?? '';
    return { lead, rest: parts.join(' · ') };
  }
  const date = value('delivery');
  const shipping = value('shipping');
  const parts = [shipping && `${t(lang, 'field.shipping')}: ${shipping}`].filter(Boolean);
  const lead = date ? t(lang, 'agreement.by', { date }) : (parts.shift() ?? '');
  return { lead, rest: parts.join(' · ') };
}

/**
 * The agreement card. Three grouped lines (what, price and deposit, delivery) show the terms at a
 * glance; "Show all details" opens the full list with a source link per term. When a message changes
 * a line, the line flashes once, and the lines changed by the latest message link back to it
 * ("from Ravi's message"). The questions and the confirm footer come in as children. Once the
 * invoice locks it, the card keeps its three lines and folds the rest.
 */
export function AgreementPanel({ view, lang, onCite, children }: { view: DealView; lang: Lang; onCite: (seq: number) => void; children?: ReactNode }) {
  const judge = useJudge();
  const a = view.agreement;
  const [details, setDetails] = useState(false);
  const [flash, setFlash] = useState<Partial<Record<Group, number>>>({});
  const lines = GROUPS.map((g) => {
    const rows = a.rows.filter((r) => g.fields.includes(r.field));
    const seqs = rows.map((r) => r.seq).filter((s): s is number => s !== null);
    return { ...g, rows, text: lineText(g.key, rows, view, lang), seq: seqs.length ? Math.max(...seqs) : null };
  });
  const signature = lines.map((l) => `${l.text.lead}|${l.text.rest}`).join('\n');

  // A line whose text changed since the last snapshot flashes once (not on the first render).
  const prev = useRef<string[] | null>(null);
  useEffect(() => {
    const now = signature.split('\n');
    const before = prev.current;
    prev.current = now;
    if (!before) return;
    const changed = GROUPS.filter((g, i) => now[i] !== before[i] && now[i] !== '|').map((g) => g.key);
    if (changed.length) setFlash((f) => Object.fromEntries(GROUPS.map((g) => [g.key, changed.includes(g.key) ? (f[g.key] ?? 0) + 1 : f[g.key]])));
  }, [signature]);

  // The latest message that set a term: the lines it touched link back to it.
  const latest = Math.max(0, ...lines.map((l) => l.seq ?? 0));
  const sourceName = (seq: number) => {
    const from = view.messages.find((m) => m.seq === seq)?.from;
    if (from === view.role) return t(lang, 'agreement.fromYou');
    return from && from !== 'system' ? t(lang, 'agreement.from', { name: view.parties[from].name }) : null;
  };

  const compact = (
    <ul data-testid="agreement-lines" className="mt-3 divide-y divide-stone-100" hidden={details}>
      {lines.map((l) => {
        const filled = Boolean(l.text.lead);
        const source = filled && l.seq !== null && l.seq === latest ? sourceName(l.seq) : null;
        return (
          <li
            key={`${l.key}-${flash[l.key] ?? 0}`}
            data-testid="agreement-line"
            data-group={l.key}
            data-filled={filled}
            className={`-mx-2 flex gap-3 rounded-xl px-2 py-2.5 ${flash[l.key] ? 'term-flash' : ''}`}
          >
            <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${filled ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-50 text-stone-300'}`} aria-hidden>
              <Icon name={l.icon} size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className={ui.meta}>{t(lang, `agreement.group.${l.key}`)}</div>
              {filled ? (
                <p className="mt-0.5 text-sm leading-relaxed text-stone-700">
                  <span className={`font-semibold text-stone-900 ${l.key === 'money' ? 'tabular-nums' : ''}`}>{l.text.lead}</span>
                  {l.text.rest && <span> · {l.text.rest}</span>}
                </p>
              ) : (
                <p className="mt-0.5 text-sm text-stone-400">{t(lang, 'agreement.notYet')}</p>
              )}
              {source && l.seq !== null && (
                <button
                  type="button"
                  data-testid="agreement-source"
                  data-seq={l.seq}
                  onClick={() => onCite(l.seq!)}
                  title={t(lang, 'agreement.cite')}
                  className="mt-1 inline-flex items-center gap-1 rounded-md text-xs text-stone-500 transition-colors hover:text-amber-800"
                >
                  <Icon name="message" size={14} />
                  {source}
                  {judge && <span className="font-mono text-[11px] text-stone-400">#{l.seq}</span>}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );

  const table = (
    <dl data-testid="agreement-details" className="mt-2 divide-y divide-stone-100" hidden={!details}>
      {a.rows.map((r, i) => (
        <div key={`${r.field}-${i}`} data-testid="agreement-row" data-field={r.field} className="flex items-baseline gap-3 py-2.5 text-sm">
          <dt className="w-28 shrink-0 text-stone-500">{r.label ?? t(lang, `field.${r.field}`)}</dt>
          <dd data-testid="agreement-value" className="min-w-0 flex-1 font-medium text-stone-900">
            {r.value}
          </dd>
          {r.seq !== null && <CiteChip seq={r.seq} lang={lang} onCite={onCite} />}
        </div>
      ))}
    </dl>
  );

  const toggle = a.rows.length > 0 && (
    <button
      type="button"
      data-testid="agreement-expand"
      aria-expanded={details}
      onClick={() => setDetails((d) => !d)}
      className={`${ui.btnGhost} -mr-2 px-2 py-0.5 text-xs text-stone-500`}
    >
      {t(lang, details ? 'agreement.hideDetails' : 'agreement.details')}
      <Icon name="chevronDown" size={14} className={`transition-transform ${details ? 'rotate-180' : ''}`} />
    </button>
  );

  const notes = (
    <>
      {a.missing.length > 0 && (
        <p data-testid="agreement-missing" className="mt-3 flex items-center gap-2 text-xs text-stone-500">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
          {t(lang, 'agreement.missing', { fields: a.missing.map((f) => t(lang, `field.${f}`)).join(', ') })}
        </p>
      )}
      {a.errors.map((e, i) => (
        <p key={i} data-testid="agreement-error" className="mt-2 flex items-start gap-2 text-xs text-red-700">
          <Icon name="alert" size={14} className="mt-px" />
          {renderIssue(lang, e)}
        </p>
      ))}
    </>
  );

  return (
    <section className={`${ui.card} p-5`} data-testid="agreement" data-locked={a.locked ? 'true' : undefined}>
      <div className="flex items-center gap-2">
        <h2 className={`${ui.title} flex-1`}>{t(lang, 'agreement.title')}</h2>
        {a.locked && (
          <span title={t(lang, 'agreement.locked')} aria-label={t(lang, 'agreement.locked')}>
            <Icon name="lock" size={14} className="text-stone-400" />
          </span>
        )}
        {toggle}
      </div>
      {a.rows.length === 0 && <p className={`${ui.meta} mt-1 leading-relaxed`}>{t(lang, 'agreement.empty')}</p>}
      {compact}
      {table}
      {notes}
      {/* Once locked, the questions and the confirm footer are history: they show with the details. */}
      {(!a.locked || details) && children}
    </section>
  );
}
