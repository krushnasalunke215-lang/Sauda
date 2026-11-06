import type { Bi, Question, QuestionField, Role } from '../../shared/types.js';

export interface QuestionDraft {
  field: QuestionField;
  to: Role;
  text: Bi;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Adds the AI's clarifying questions, skipping any whose field already has an open question
 * ('other' questions are deduped by their text instead). Returns the new list and the added ones.
 */
export function addQuestions(
  questions: Question[],
  drafts: QuestionDraft[],
  messageId: string,
  now: Date,
): { questions: Question[]; added: Question[] } {
  const list = [...questions];
  const added: Question[] = [];
  for (const d of drafts) {
    if (!d.text.maker.trim() && !d.text.buyer.trim()) continue;
    const dup = list.some(
      (q) => q.status === 'open' && q.field === d.field && (d.field !== 'other' || norm(q.text.buyer) === norm(d.text.buyer) || norm(q.text.maker) === norm(d.text.maker)),
    );
    if (dup) continue;
    const q: Question = {
      id: `q${list.length + 1}`,
      field: d.field,
      to: d.to,
      text: { maker: d.text.maker.trim(), buyer: d.text.buyer.trim() },
      status: 'open',
      raisedBy: messageId,
      createdAt: now.toISOString(),
    };
    list.push(q);
    added.push(q);
  }
  return { questions: list, added };
}

/** Resolves open questions about fields the turn just set. 'other' questions only close by dismissal. */
export function resolveByPatch(questions: Question[], set: QuestionField[], messageId: string): { questions: Question[]; resolved: Question[] } {
  const resolved: Question[] = [];
  const list = questions.map((q) => {
    if (q.status !== 'open' || q.field === 'other' || !set.includes(q.field)) return q;
    const r: Question = { ...q, status: 'resolved', resolvedBy: messageId };
    resolved.push(r);
    return r;
  });
  return { questions: list, resolved };
}

/** Dismisses an open question. Returns null when the id is unknown or the question is not open. */
export function dismiss(questions: Question[], id: string, by: Role): Question[] | null {
  const q = questions.find((x) => x.id === id);
  if (!q || q.status !== 'open') return null;
  return questions.map((x) => (x.id === id ? { ...x, status: 'dismissed', resolvedBy: by } : x));
}
