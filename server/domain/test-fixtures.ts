/** Fixtures for unit tests (not a test file itself). */
import type { Deal, InvoiceSnapshot, Message, Role } from '../../shared/types.js';
import { makeDeal } from '../deals/store.js';
import { emptyPatch, patchDeal, type TermsPatch } from './agreement.js';

export const NOW = new Date('2026-11-06T13:00:00Z');
export const TODAY = '2026-11-06';

export const PARTIES = {
  maker: { name: 'Ravi Chikan Studio', lang: 'hi' as const },
  buyer: { name: 'Emily Carter', lang: 'en' as const },
};

/** The order from the spike: USD 120, 30% deposit, 44 in, light green, by 10 Dec 2026. */
export const SPIKE_PATCH: TermsPatch = {
  ...emptyPatch(),
  item: { maker: 'हाथ की कढ़ाई वाला चिकनकारी कुर्ता', buyer: 'Hand-embroidered chikankari kurta' },
  size: { maker: 'मीडियम', buyer: 'Medium' },
  measurements: [{ key: 'length', label: { maker: 'लंबाई', buyer: 'Length' }, value: 44, unit: 'in' }],
  color: { maker: 'हल्का हरा', buyer: 'Light green' },
  priceAmount: 120,
  priceCurrency: 'USD',
  depositPercent: 30,
  deliveryDateIso: '2026-12-10',
  deliveryDateSpoken: '10 दिसंबर',
};

export function message(deal: Deal, from: Role, text: string): Message {
  const m: Message = {
    id: `m${deal.nextSeq}`,
    seq: deal.nextSeq,
    from,
    kind: 'text',
    status: 'done',
    original: { text, lang: deal.parties[from].lang },
    createdAt: NOW.toISOString(),
  };
  deal.nextSeq += 1;
  deal.messages.push(m);
  return m;
}

/** A deal whose maker message m1 stated the whole spike order. */
export function spikeDeal(): Deal {
  const deal = makeDeal(PARTIES, NOW);
  deal.id = 'TESTDEAL';
  const m = message(deal, 'maker', 'नमस्ते जी! ...');
  patchDeal(deal, SPIKE_PATCH, m.id, NOW, TODAY);
  return deal;
}

export function invoice(over: Partial<InvoiceSnapshot> = {}): InvoiceSnapshot {
  return {
    id: 'INV2-TEST-0000-0000-0001',
    number: '0001',
    status: 'UNPAID',
    payerUrl: 'https://www.sandbox.paypal.com/invoice/p/#INV2-TEST-0000-0000-0001',
    totalCents: 12000,
    paidCents: 0,
    dueCents: 12000,
    depositCents: 3600,
    transactions: [],
    noteSha256: '',
    textMatches: true,
    ...over,
  };
}
