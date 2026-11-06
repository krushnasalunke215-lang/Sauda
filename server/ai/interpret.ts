import { otherRole, type Bi, type Deal, type Lang, type Role, type TurnIntent } from '../../shared/types.js';
import { emptyPatch, type TermsPatch } from '../domain/agreement.js';
import type { QuestionDraft } from '../domain/questions.js';
import { generateJson, type Attempt, type GenerateDeps, type Part } from './gemini.js';
import { buildTurnContext, TURN_SYSTEM } from './prompts.js';
import { TURN_SCHEMA, validateTurn, type TurnOutput } from './schemas.js';

export type TurnInput = { text: string } | { audio: { mimeType: string; data: Buffer } };

export interface TurnResult {
  transcript: string;
  /** BCP-47 code of the language the turn was in. */
  detectedLanguage: string;
  translation: { text: string; lang: Lang };
  patch: TermsPatch;
  questions: QuestionDraft[];
  intent: TurnIntent;
  ai: { model: string; ms: number; fallback: boolean };
  attempts: Attempt[];
}

/** Interprets one turn. Injected into the deal service so tests can fake it. */
export type Interpreter = (deal: Deal, speaker: Role, input: TurnInput) => Promise<TurnResult>;

const s = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Both sides of a term; a missing side falls back to the other one, and an empty term becomes null. */
function normBi(b: { maker: string; buyer: string } | null): Bi | null {
  if (!b) return null;
  const maker = s(b.maker);
  const buyer = s(b.buyer);
  if (!maker && !buyer) return null;
  return { maker: maker ?? buyer!, buyer: buyer ?? maker! };
}

/** Turns the raw model output into the app's types. Values are checked later by dropInvalid(). */
export function normalizeTurn(out: TurnOutput, deal: Deal, speaker: Role, input: TurnInput): Omit<TurnResult, 'ai' | 'attempts'> {
  const t = out.terms;
  const patch: TermsPatch = {
    ...emptyPatch(),
    item: normBi(t.item),
    quantity: t.quantity,
    size: normBi(t.size),
    color: normBi(t.color),
    measurements: t.measurements.flatMap((m) => {
      const label = normBi(m.label);
      const key = s(m.key)?.toLowerCase().replace(/\s+/g, '_');
      return label && key ? [{ key, label, value: m.value, unit: m.unit }] : [];
    }),
    priceAmount: t.price_amount,
    priceCurrency: s(t.price_currency),
    depositPercent: t.deposit_percent,
    depositAmount: t.deposit_amount,
    deliveryDateIso: s(t.delivery_date_iso),
    deliveryDateSpoken: s(t.delivery_date_spoken),
    shippingIncluded: t.shipping_included,
  };
  const questions: QuestionDraft[] = out.questions.flatMap((q) => {
    const text = normBi({ maker: q.text_maker, buyer: q.text_buyer });
    return text ? [{ field: q.field, to: q.to, text }] : [];
  });
  const kind = out.intent.kind;
  const intent: TurnIntent =
    kind === 'none'
      ? { kind, carrier: null, trackingNumber: null }
      : { kind, carrier: s(out.intent.carrier), trackingNumber: s(out.intent.tracking_number)?.replace(/[\s-]/g, '') ?? null };
  const listenerLang = deal.parties[otherRole(speaker)].lang;
  return {
    // A typed turn keeps exactly what was typed; a spoken one uses the model's transcript.
    transcript: 'text' in input ? input.text : out.transcript.trim(),
    detectedLanguage: s(out.detected_language)?.toLowerCase() ?? deal.parties[speaker].lang,
    translation: { text: out.translation.trim(), lang: listenerLang },
    patch,
    questions,
    intent,
  };
}

/** Interprets a typed or spoken turn with one schema-constrained Gemini call (fast model first, then the fallback). */
export async function interpretTurn(deal: Deal, speaker: Role, input: TurnInput, deps: GenerateDeps, now: Date = new Date()): Promise<TurnResult> {
  const context: Part = { text: `Deal context (JSON):\n${buildTurnContext(deal, speaker, now)}` };
  const turn: Part[] =
    'text' in input
      ? [{ text: `The ${speaker} typed this turn:\n${input.text}` }]
      : [{ inlineData: { mimeType: input.audio.mimeType, data: input.audio.data.toString('base64') } }, { text: `The audio is one spoken turn from the ${speaker}.` }];
  const r = await generateJson<TurnOutput>(
    { label: 'turn', parts: [context, ...turn], system: TURN_SYSTEM, schema: TURN_SCHEMA, validate: validateTurn },
    deps,
  );
  return { ...normalizeTurn(r.data, deal, speaker, input), ai: { model: r.model, ms: r.ms, fallback: r.fallback }, attempts: r.attempts };
}

export function createInterpreter(deps: GenerateDeps): Interpreter {
  return (deal, speaker, input) => interpretTurn(deal, speaker, input, deps);
}
