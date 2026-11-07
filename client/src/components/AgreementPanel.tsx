import type { ReactNode } from 'react';
import type { DealView, Lang } from '../../../shared/types.js';
import { renderIssue, t } from '../i18n.js';
import { ui } from '../ui.js';
import { Icon } from './Icon.js';

export function CiteChip({ seq, lang, onCite }: { seq: number; lang: Lang; onCite: (seq: number) => void }) {
  return (
    <button
      type="button"
      data-testid="citation"
      data-seq={seq}
      title={t(lang, 'agreement.cite')}
      onClick={() => onCite(seq)}
      className="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-stone-400 transition-colors hover:bg-amber-50 hover:text-amber-800"
    >
      #{seq}
    </button>
  );
}

/**
 * The agreement card: the terms (each with its citation), what is still missing, and the
 * questions and confirm footer passed as children. Once the invoice locks it, it folds into a
 * one-line summary that opens on click.
 */
export function AgreementPanel({ view, lang, onCite, children }: { view: DealView; lang: Lang; onCite: (seq: number) => void; children?: ReactNode }) {
  const a = view.agreement;
  const body = (
    <>
      {a.rows.length === 0 ? (
        <p className="mt-3 rounded-xl bg-stone-50 px-4 py-3 text-sm leading-relaxed text-stone-500">{t(lang, 'agreement.empty')}</p>
      ) : (
        <dl className="mt-2 divide-y divide-stone-100">
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
      )}
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
      {children}
    </>
  );

  if (a.locked) {
    const gist = ['item', 'price'].map((f) => a.rows.find((r) => r.field === f)?.value).filter(Boolean).join(' · ');
    return (
      <details className={`${ui.card} group p-5`} data-testid="agreement" data-locked="true">
        <summary className={`${ui.summary} flex items-center gap-2`} title={t(lang, 'agreement.locked')}>
          <div className="min-w-0 flex-1">
            <h2 className={ui.title}>{t(lang, 'agreement.title')}</h2>
            {gist && <p className={`${ui.meta} mt-0.5 truncate group-open:hidden`}>{gist}</p>}
          </div>
          <Icon name="lock" size={14} className="text-stone-400" />
          <Icon name="chevronDown" className="text-stone-400 transition-transform group-open:rotate-180" />
        </summary>
        {body}
      </details>
    );
  }
  return (
    <section className={`${ui.card} p-5`} data-testid="agreement">
      <h2 className={ui.title}>{t(lang, 'agreement.title')}</h2>
      {body}
    </section>
  );
}
