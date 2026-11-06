import { describe, expect, it } from 'vitest';
import { addQuestions, dismiss, resolveByPatch } from './questions.js';
import { NOW } from './test-fixtures.js';

const shipping = {
  field: 'shipping' as const,
  to: 'maker' as const,
  text: { maker: 'क्या 120 डॉलर में अमेरिका तक शिपिंग शामिल है?', buyer: 'Does the $120 include shipping to the USA?' },
};

describe('questions', () => {
  it('dedupes against open questions with the same field', () => {
    const a = addQuestions([], [shipping], 'm1', NOW);
    expect(a.added).toHaveLength(1);
    expect(a.questions[0]).toMatchObject({ id: 'q1', field: 'shipping', to: 'maker', status: 'open', raisedBy: 'm1' });
    const b = addQuestions(a.questions, [{ ...shipping, text: { maker: 'शिपिंग?', buyer: 'Shipping included?' } }], 'm2', NOW);
    expect(b.added).toHaveLength(0);
    expect(b.questions).toHaveLength(1);
  });

  it('resolves an open question when a turn sets its field', () => {
    const { questions } = addQuestions([], [shipping], 'm1', NOW);
    const r = resolveByPatch(questions, ['price'], 'm2');
    expect(r.resolved).toHaveLength(0);
    const s = resolveByPatch(questions, ['shipping'], 'm3');
    expect(s.questions[0]).toMatchObject({ status: 'resolved', resolvedBy: 'm3' });
    // Once resolved, the same field can be asked again.
    expect(addQuestions(s.questions, [shipping], 'm4', NOW).added).toHaveLength(1);
  });

  it("closes 'other' questions only by dismissal", () => {
    const other = { field: 'other' as const, to: 'buyer' as const, text: { maker: 'कोई और माप?', buyer: 'Any other measurements?' } };
    const { questions } = addQuestions([], [other, other], 'm1', NOW);
    expect(questions).toHaveLength(1);
    expect(resolveByPatch(questions, ['measurements', 'other'], 'm2').resolved).toHaveLength(0);
    const d = dismiss(questions, 'q1', 'buyer');
    expect(d?.[0]).toMatchObject({ status: 'dismissed', resolvedBy: 'buyer' });
    expect(dismiss(d!, 'q1', 'buyer')).toBeNull();
    expect(dismiss(questions, 'q9', 'buyer')).toBeNull();
  });
});
