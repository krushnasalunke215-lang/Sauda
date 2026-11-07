import type { DealView, Lang } from '../../../shared/types.js';
import { t } from '../i18n.js';
import { ui } from '../ui.js';
import { CiteChip } from './AgreementPanel.js';
import { Icon } from './Icon.js';

interface Props {
  view: DealView;
  lang: Lang;
  onCite: (seq: number) => void;
  onDismiss: (id: string) => void;
}

/** Open questions inside the agreement card; answered ones fold away. Nothing shows when there are none. */
export function QuestionsPanel({ view, lang, onCite, onDismiss }: Props) {
  const seqOf = (id: string | undefined) => view.messages.find((m) => m.id === id)?.seq ?? null;
  const open = view.questions.filter((q) => q.status === 'open');
  const closed = view.questions.filter((q) => q.status !== 'open');
  if (open.length === 0 && closed.length === 0) return null;
  return (
    <section className="mt-4" data-testid="questions">
      {open.length > 0 && (
        <>
          <h3 className="text-xs font-semibold text-stone-900">{t(lang, 'questions.title')}</h3>
          <ul className="mt-2 space-y-2">
            {open.map((q) => {
              const raised = seqOf(q.raisedBy);
              const forMe = q.to === view.role;
              const who = forMe ? t(lang, 'questions.forYou') : t(lang, 'questions.forOther', { name: view.parties[q.to].name });
              return (
                <li
                  key={q.id}
                  data-testid="question"
                  data-field={q.field}
                  data-to={q.to}
                  className={`rounded-xl px-3 py-2.5 text-sm ${forMe ? 'bg-amber-50' : 'bg-stone-50'}`}
                >
                  <p data-testid="question-text" className="leading-relaxed text-stone-900">
                    {q.text[view.role]}
                  </p>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-stone-500">
                    <span className={forMe ? 'font-medium text-amber-800' : ''}>{who}</span>
                    {raised !== null && <CiteChip seq={raised} lang={lang} onCite={onCite} />}
                    <button
                      type="button"
                      data-testid="question-dismiss"
                      className={`${ui.btnGhost} ml-auto px-1.5 py-0.5 text-xs`}
                      onClick={() => onDismiss(q.id)}
                    >
                      {t(lang, 'questions.dismiss')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {closed.length > 0 && (
        <details className="group mt-3">
          <summary className={`${ui.summary} flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800`}>
            {t(lang, 'questions.closed', { n: closed.length })}
            <Icon name="chevronDown" size={14} className="transition-transform group-open:rotate-180" />
          </summary>
          <ul className="mt-2 space-y-1.5">
            {closed.map((q) => {
              const answered = q.status === 'resolved' ? seqOf(q.resolvedBy) : null;
              return (
                <li key={q.id} data-testid="question-closed" data-status={q.status} className="flex items-center gap-2 text-xs text-stone-500">
                  <Icon name={q.status === 'resolved' ? 'check' : 'x'} size={13} className={q.status === 'resolved' ? 'text-emerald-600' : 'text-stone-400'} />
                  <span className="flex-1">{q.text[view.role]}</span>
                  {q.status === 'resolved' && answered !== null ? (
                    <CiteChip seq={answered} lang={lang} onCite={onCite} />
                  ) : (
                    <span className="text-stone-400">{t(lang, 'questions.dismissed')}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}
