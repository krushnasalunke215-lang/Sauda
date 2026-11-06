import type { DealView, Lang } from '../../../shared/types.js';
import { renderIssue, t } from '../i18n.js';

export function CiteChip({ seq, lang, onCite }: { seq: number; lang: Lang; onCite: (seq: number) => void }) {
  return (
    <button
      type="button"
      data-testid="citation"
      data-seq={seq}
      title={t(lang, 'agreement.cite')}
      onClick={() => onCite(seq)}
      className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] text-amber-900 hover:bg-amber-200"
    >
      #{seq}
    </button>
  );
}

export function AgreementPanel({ view, lang, onCite }: { view: DealView; lang: Lang; onCite: (seq: number) => void }) {
  const a = view.agreement;
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4" data-testid="agreement">
      <h2 className="text-sm font-semibold text-stone-600">{t(lang, 'agreement.title')}</h2>
      {a.rows.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">{t(lang, 'agreement.empty')}</p>
      ) : (
        <dl className="mt-2 divide-y divide-stone-100">
          {a.rows.map((r, i) => (
            <div key={`${r.field}-${i}`} data-testid="agreement-row" data-field={r.field} className="flex items-start gap-2 py-1.5 text-sm">
              <dt className="w-28 shrink-0 text-stone-500">{r.label ?? t(lang, `field.${r.field}`)}</dt>
              <dd data-testid="agreement-value" className="flex-1 font-medium">
                {r.value}
              </dd>
              {r.seq !== null && <CiteChip seq={r.seq} lang={lang} onCite={onCite} />}
            </div>
          ))}
        </dl>
      )}
      {a.missing.length > 0 && (
        <p data-testid="agreement-missing" className="mt-3 text-xs text-stone-500">
          {t(lang, 'agreement.missing', { fields: a.missing.map((f) => t(lang, `field.${f}`)).join(', ') })}
        </p>
      )}
      {a.errors.map((e, i) => (
        <p key={i} data-testid="agreement-error" className="mt-2 text-xs text-red-700">
          {renderIssue(lang, e)}
        </p>
      ))}
      {a.locked && <p className="mt-2 text-xs text-sky-800">{t(lang, 'agreement.locked')}</p>}
    </section>
  );
}
