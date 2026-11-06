import { otherRole, type Deal, type Lang, type Role } from '../../shared/types.js';
import { derive } from '../domain/agreement.js';
import { todayUtc } from '../domain/dates.js';

const LANG_NAMES: Record<Lang, string> = { hi: 'Hindi', en: 'English', es: 'Spanish' };

export const TURN_SYSTEM = [
  'You are the interpreter inside Sauda, a deal room where a maker and a buyer who speak different languages negotiate a custom order.',
  'Each request is one turn from one party, with a JSON context of the deal so far.',
  "Transcribe the turn verbatim in the speaker's own script and translate it faithfully and naturally into the listener's language, keeping the tone.",
  'Extract only the order terms stated or clearly agreed in this turn. Use the context to understand short answers to open questions (for example "yes, it is included" answers an open shipping question). Never invent or carry over terms that this turn does not state.',
  'Give amounts as plain numbers and currencies as ISO 4217 codes. "Dollars" from a buyer in the USA means USD. Price means the total price of the whole order.',
  'Resolve dates without a year to the next future occurrence after today and give them as YYYY-MM-DD.',
  "Write every term's text fields twice: maker in the maker's language and buyer in the buyer's language.",
  'questions lists what must be settled before both sides can confirm, at most 2 per turn: (1) when the speaker asks the other party about a term in this turn, record that question addressed to the other party; (2) when this turn leaves an important ambiguity in money, size, the delivery date or shipping, for example a price quoted without saying whether shipping to the buyer is included, ask the party who must answer.',
  'Skip questions already in open_questions or already answered in recent_messages. Write each question in both languages.',
  'Set intent only when the speaker asks for an action: add_tracking when the maker says a parcel was shipped with a carrier and tracking number, send_reminder when the maker asks to remind the buyer to pay. Otherwise intent kind is none.',
].join(' ');

/** A compact JSON description of the deal for the model: who is speaking, the terms so far, open questions and recent turns. */
export function buildTurnContext(deal: Deal, speaker: Role, now: Date = new Date()): string {
  const listener = otherRole(speaker);
  const t = deal.terms;
  const d = derive(t);
  const lang = (r: Role) => deal.parties[r].lang;
  const ctx = {
    today: todayUtc(now),
    speaker,
    listener,
    parties: {
      maker: { name: deal.parties.maker.name, language: LANG_NAMES[lang('maker')], code: lang('maker') },
      buyer: { name: deal.parties.buyer.name, language: LANG_NAMES[lang('buyer')], code: lang('buyer') },
    },
    translate_into: { language: LANG_NAMES[lang(listener)], code: lang(listener) },
    current_terms: {
      item: t.item?.value.buyer ?? null,
      quantity: t.quantity?.value ?? null,
      size: t.size?.value.buyer ?? null,
      measurements: t.measurements.map((m) => ({ key: m.value.key, value: m.value.value, unit: m.value.unit })),
      color: t.color?.value.buyer ?? null,
      price: d.totalCents !== null ? { amount: d.totalCents / 100, currency: d.currency } : null,
      deposit: d.depositCents !== null ? { amount: d.depositCents / 100, percent: d.depositPercent } : null,
      delivery_date: t.delivery?.value.dateIso ?? null,
      shipping_included: t.shippingIncluded?.value ?? null,
    },
    open_questions: deal.questions.filter((q) => q.status === 'open').map((q) => ({ field: q.field, to: q.to, text: q.text.buyer })),
    recent_messages: deal.messages
      .filter((m) => m.status === 'done' && m.from !== 'system' && m.original)
      .slice(-8)
      .map((m) => ({ from: m.from, original: m.original!.text, translation: m.translation?.text ?? null })),
  };
  return JSON.stringify(ctx);
}
