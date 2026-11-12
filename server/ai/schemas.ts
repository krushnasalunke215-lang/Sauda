import { Ajv } from 'ajv';
import { CHECK_FIELDS, CHECK_STATUSES, QUESTION_FIELDS, type CheckField, type CheckStatus } from '../../shared/types.js';

const nullable = (s: Record<string, unknown>) => ({ anyOf: [s, { type: 'null' }] });

const bi = (what: string) => ({
  type: 'object',
  additionalProperties: false,
  description: `${what}, written once in the maker's language and once in the buyer's language.`,
  properties: {
    maker: { type: 'string', description: "In the maker's language." },
    buyer: { type: 'string', description: "In the buyer's language." },
  },
  required: ['maker', 'buyer'],
});

/** One interpreted turn: transcript, translation, the terms stated in this turn, questions and an intent. */
export const TURN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    transcript: {
      type: 'string',
      description: "Verbatim text of the turn in the speaker's own script (Devanagari for Hindi, kanji and kana for Japanese). For typed text, repeat it exactly.",
    },
    detected_language: { type: 'string', description: 'BCP-47 code of the language the turn is in, e.g. hi, en, es, fr, pt, de, ja.' },
    translation: { type: 'string', description: "Faithful, natural translation of the whole turn into the listener's language." },
    terms: {
      type: 'object',
      additionalProperties: false,
      description: 'Order terms stated or clearly agreed in this turn only. Use null or [] when not stated. Never invent values.',
      properties: {
        item: nullable(bi('What is being made')),
        quantity: nullable({ type: 'integer', description: 'Number of pieces.' }),
        size: nullable(bi('The size, e.g. Medium')),
        measurements: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              key: { type: 'string', description: 'Lowercase English key, e.g. length, chest, waist, sleeve.' },
              label: bi('The measurement name'),
              value: { type: 'number' },
              unit: { type: 'string', enum: ['in', 'cm'] },
            },
            required: ['key', 'label', 'value', 'unit'],
          },
        },
        color: nullable(bi('The colour')),
        price_amount: nullable({ type: 'number', description: 'Total price of the whole order as a plain number, no symbols.' }),
        price_currency: nullable({ type: 'string', description: 'ISO 4217 code, e.g. USD.' }),
        deposit_percent: nullable({ type: 'number', description: 'Advance / deposit as a percent of the total, 0-100.' }),
        deposit_amount: nullable({ type: 'number', description: 'Advance / deposit as an amount, when stated as money.' }),
        delivery_date_iso: nullable({ type: 'string', description: 'YYYY-MM-DD.' }),
        delivery_date_spoken: nullable({ type: 'string', description: 'The date phrase as said, in the original script.' }),
        shipping_included: nullable({ type: 'boolean', description: 'Whether the price includes shipping to the buyer.' }),
      },
      required: [
        'item', 'quantity', 'size', 'measurements', 'color', 'price_amount', 'price_currency',
        'deposit_percent', 'deposit_amount', 'delivery_date_iso', 'delivery_date_spoken', 'shipping_included',
      ],
    },
    questions: {
      type: 'array',
      description: 'Clarifying questions about unresolved money, size, date or shipping ambiguity. Usually empty.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          field: { type: 'string', enum: [...QUESTION_FIELDS] },
          to: { type: 'string', enum: ['maker', 'buyer'], description: 'The party who must answer.' },
          text_maker: { type: 'string', description: "The question in the maker's language." },
          text_buyer: { type: 'string', description: "The question in the buyer's language." },
        },
        required: ['field', 'to', 'text_maker', 'text_buyer'],
      },
    },
    intent: {
      type: 'object',
      additionalProperties: false,
      description: 'An action the speaker asks for in this turn. kind none for normal negotiation.',
      properties: {
        kind: { type: 'string', enum: ['none', 'add_tracking', 'send_reminder'] },
        carrier: nullable({ type: 'string', description: 'Shipping carrier as said, e.g. DHL.' }),
        tracking_number: nullable({ type: 'string', description: 'Tracking number, digits and letters only.' }),
      },
      required: ['kind', 'carrier', 'tracking_number'],
    },
  },
  required: ['transcript', 'detected_language', 'translation', 'terms', 'questions', 'intent'],
} as const;

type BiOut = { maker: string; buyer: string };

/** The raw model output for TURN_SCHEMA. */
export interface TurnOutput {
  transcript: string;
  detected_language: string;
  translation: string;
  terms: {
    item: BiOut | null;
    quantity: number | null;
    size: BiOut | null;
    measurements: { key: string; label: BiOut; value: number; unit: 'in' | 'cm' }[];
    color: BiOut | null;
    price_amount: number | null;
    price_currency: string | null;
    deposit_percent: number | null;
    deposit_amount: number | null;
    delivery_date_iso: string | null;
    delivery_date_spoken: string | null;
    shipping_included: boolean | null;
  };
  questions: { field: (typeof QUESTION_FIELDS)[number]; to: 'maker' | 'buyer'; text_maker: string; text_buyer: string }[];
  intent: { kind: 'none' | 'add_tracking' | 'send_reminder'; carrier: string | null; tracking_number: string | null };
}

/** What a buyer's reference photo shows. */
export const REFERENCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    description: bi('One or two sentences on what the photo shows that matters for the order'),
    details: {
      type: 'array',
      description: 'Up to 6 visible details that matter for making the item (embroidery, neckline, sleeves, fabric, colour). Empty when nothing is clear.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          aspect: { type: 'string', description: 'Lowercase English key, e.g. neckline, embroidery, color, sleeves, fabric.' },
          value: bi('The detail as a short phrase that names the aspect, e.g. "Neckline: round with a keyhole"'),
        },
        required: ['aspect', 'value'],
      },
    },
  },
  required: ['description', 'details'],
} as const;

/** A maker's progress photo checked against the agreement. */
export const PROGRESS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    checks: {
      type: 'array',
      description: 'One check per agreed term that a photo could show (item, color, size, measurements), plus other only for something clearly relevant.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          field: { type: 'string', enum: [...CHECK_FIELDS] },
          status: {
            type: 'string',
            enum: [...CHECK_STATUSES],
            description: 'matches or differs only when the photo clearly shows it; otherwise cannot_verify.',
          },
          note: bi('What the photo shows for this term, in a short sentence'),
        },
        required: ['field', 'status', 'note'],
      },
    },
    summary: bi('One sentence for both parties; say that the check is advisory'),
  },
  required: ['checks', 'summary'],
} as const;

export interface ReferenceOutput {
  description: BiOut;
  details: { aspect: string; value: BiOut }[];
}

export interface ProgressOutput {
  checks: { field: CheckField; status: CheckStatus; note: BiOut }[];
  summary: BiOut;
}

const ajv = new Ajv({ strict: false, allErrors: true });
export const validateTurn = ajv.compile<TurnOutput>(TURN_SCHEMA);
export const validateReference = ajv.compile<ReferenceOutput>(REFERENCE_SCHEMA);
export const validateProgress = ajv.compile<ProgressOutput>(PROGRESS_SCHEMA);
