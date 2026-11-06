import type { DealView, Lang } from '../../../shared/types.js';
import { t } from '../i18n.js';
import { CiteChip } from './AgreementPanel.js';

interface Props {
  view: DealView;
  lang: Lang;
  onCite: (seq: number) => void;
  onDismiss: (id: string) => void;
}

export function QuestionsPanel({ view, lang, onCite, onDismiss }: Props) {
  const seqOf = (id: string | undefined) => view.messages.find((m) => m.id === id)?.seq ?? null;
  const open = view.questions.filter((q) => q.status === 'open');
  const closed = view.questions.filter((q) => q.status !== 'open');
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4" data-testid="questions">
      <h2 className="text-sm font-semibold text-stone-600">{t(lang, 'questions.title')}</h2>
      {open.length === 0 && <p className="mt-2 text-sm text-stone-500">{t(lang, 'questions.none')}</p>}
      <ul className="mt-2 space-y-2">
        {open.map((q) => {
          const raised = seqOf(q.raisedBy);
          const forMe = q.to === view.role;
          const who = forMe ? t(lang, 'questions.forYou') : t(lang, 'questions.forOther', { name: view.parties[q.to].name });
          const cls = forMe ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-stone-50';
          return (
            <li key={q.id} data-testid="question" data-field={q.field} data-to={q.to} className={`rounded-lg p-2 text-sm ${cls}`}>
              <p data-testid="question-text" className="font-medium">
                {q.text[view.role]}
              </p>
              <div className="mt-1 flex items-center gap-2 text-xs text-stone-500">
                <span>{who}</span>
                <span>· {t(lang, `field.${q.field}`)}</span>
                {raised !== null && <CiteChip seq={raised} lang={lang} onCite={onCite} />}
                <button type="button" data-testid="question-dismiss" className="ml-auto rounded border border-stone-300 px-2 py-0.5 hover:bg-white" onClick={() => onDismiss(q.id)}>
                  {t(lang, 'questions.dismiss')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {closed.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-stone-100 pt-2">
          {closed.map((q) => {
            const answered = q.status === 'resolved' ? seqOf(q.resolvedBy) : null;
            return (
              <li key={q.id} data-testid="question-closed" data-status={q.status} className="flex items-center gap-2 text-xs text-stone-500">
                <span className="text-emerald-700">{q.status === 'resolved' ? '✓' : '–'}</span>
                <span className="flex-1 line-through decoration-stone-300">{q.text[view.role]}</span>
                {q.status === 'resolved' && answered !== null ? (
                  <>
                    <span>{t(lang, 'questions.answered')}</span>
                    <CiteChip seq={answered} lang={lang} onCite={onCite} />
                  </>
                ) : (
                  <span>{t(lang, 'questions.dismissed')}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
