import { describe, expect, it } from 'vitest';
import { makeDeal } from '../deals/store.js';
import { NOW, PARTIES } from '../domain/test-fixtures.js';
import type { CallModel, ModelRequest } from './gemini.js';
import { interpretTurn } from './interpret.js';
import { validateTurn, type TurnOutput } from './schemas.js';

const HINDI = 'नमस्ते जी! आपका चिकनकारी कुर्ता हाथ की कढ़ाई से बनेगा। साइज़ मीडियम, लंबाई 44 इंच, रंग हल्का हरा। कुल कीमत 120 डॉलर, 30 प्रतिशत एडवांस देना होगा। डिलीवरी 10 दिसंबर तक हो जाएगी।';

/** A canned answer in the shape Gemini returned in the spike, with some untidy values. */
const CANNED: TurnOutput = {
  transcript: ' नमस्ते जी। आपका चिकनकारी कुर्ता ... ',
  detected_language: 'HI',
  translation: ' Hello! Your chikankari kurta will be made with hand embroidery. Size medium, length 44 inches, colour light green. Total price 120 dollars; a 30 percent advance is required. Delivery by December 10. ',
  terms: {
    item: { maker: 'हाथ की कढ़ाई वाला चिकनकारी कुर्ता', buyer: 'Hand-embroidered chikankari kurta' },
    quantity: null,
    size: { maker: 'मीडियम', buyer: '' },
    measurements: [
      { key: 'Length', label: { maker: 'लंबाई', buyer: 'Length' }, value: 44, unit: 'in' },
      { key: '', label: { maker: 'x', buyer: 'x' }, value: 1, unit: 'in' },
    ],
    color: { maker: 'हल्का हरा', buyer: 'Light green' },
    price_amount: 120,
    price_currency: 'USD',
    deposit_percent: 30,
    deposit_amount: null,
    delivery_date_iso: '2026-12-10',
    delivery_date_spoken: '10 दिसंबर',
    shipping_included: null,
  },
  questions: [
    { field: 'shipping', to: 'maker', text_maker: 'क्या 120 डॉलर में अमेरिका तक शिपिंग शामिल है?', text_buyer: 'Does the $120 include shipping to the USA?' },
    { field: 'other', to: 'buyer', text_maker: ' ', text_buyer: '' },
  ],
  intent: { kind: 'none', carrier: 'DHL', tracking_number: null },
};

function fakeModel(out: unknown) {
  const calls: ModelRequest[] = [];
  const call: CallModel = async (r) => {
    calls.push(r);
    return JSON.stringify(out);
  };
  return { call, calls };
}

const settings = { fastModel: 'gemini-3.8-flash', fallbackModel: 'gemini-4-argon', fastTimeoutMs: 1000, fallbackTimeoutMs: 1000 };

describe('interpretTurn', () => {
  it('the canned result is valid against TURN_SCHEMA', () => {
    expect(validateTurn(CANNED)).toBe(true);
  });

  it('normalizes a canned Hindi result', async () => {
    const deal = makeDeal(PARTIES, NOW);
    const f = fakeModel(CANNED);
    const r = await interpretTurn(deal, 'maker', { text: HINDI }, { callModel: f.call, settings }, NOW);
    expect(r.transcript).toBe(HINDI);
    expect(r.detectedLanguage).toBe('hi');
    expect(r.translation).toEqual({ text: expect.stringMatching(/^Hello! .*December 10\.$/), lang: 'en' });
    expect(r.patch).toMatchObject({
      item: { buyer: 'Hand-embroidered chikankari kurta' },
      size: { maker: 'मीडियम', buyer: 'मीडियम' },
      measurements: [{ key: 'length', value: 44, unit: 'in' }],
      priceAmount: 120,
      priceCurrency: 'USD',
      depositPercent: 30,
      deliveryDateIso: '2026-12-10',
      shippingIncluded: null,
    });
    expect(r.questions).toEqual([
      { field: 'shipping', to: 'maker', text: { maker: 'क्या 120 डॉलर में अमेरिका तक शिपिंग शामिल है?', buyer: 'Does the $120 include shipping to the USA?' } },
    ]);
    expect(r.intent).toEqual({ kind: 'none', carrier: null, trackingNumber: null });
    expect(r.ai).toMatchObject({ model: 'gemini-3.8-flash', fallback: false });
  });

  it('sends the deal context and the turn to the model', async () => {
    const deal = makeDeal(PARTIES, NOW);
    const f = fakeModel(CANNED);
    await interpretTurn(deal, 'buyer', { text: 'Does the 120 dollars include shipping to Ohio?' }, { callModel: f.call, settings }, NOW);
    const texts = f.calls[0].parts.map((p) => p.text ?? '').join('\n');
    expect(texts).toContain('"today":"2026-11-06"');
    expect(texts).toContain('"translate_into":{"language":"Hindi","code":"hi"}');
    expect(texts).toContain('The buyer typed this turn:\nDoes the 120 dollars include shipping to Ohio?');
  });

  it('keeps a tracking intent with a cleaned number', async () => {
    const deal = makeDeal(PARTIES, NOW);
    const f = fakeModel({ ...CANNED, intent: { kind: 'add_tracking', carrier: ' DHL ', tracking_number: '4567 891-234' } });
    const r = await interpretTurn(deal, 'maker', { text: 'पार्सल डीएचएल से भेज दिया है' }, { callModel: f.call, settings }, NOW);
    expect(r.intent).toEqual({ kind: 'add_tracking', carrier: 'DHL', trackingNumber: '4567891234' });
  });
});
