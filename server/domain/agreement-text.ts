import type { AgreementIssue, AgreementRow, Deal, Lang, Role } from '../../shared/types.js';
import { canonicalHash, derive } from './agreement.js';
import { formatDate } from './dates.js';
import { formatMoney } from './money.js';
import { bothConfirmed } from './phase.js';
import { formatMeasurement } from './units.js';

interface Labels {
  title: string;
  maker: string;
  buyer: string;
  langName: string;
  item: string;
  quantity: string;
  size: string;
  measurements: string;
  color: string;
  price: string;
  deposit: string;
  balance: string;
  delivery: string;
  shipping: string;
  shippingYes: string;
  shippingNo: string;
  depositWhen: string;
  balanceWhen: string;
  confirmed: (date: string) => string;
  termsTitle: string;
  termDeposit: (amount: string) => string;
  termBalance: string;
  termMadeToOrder: string;
}

export const LABELS: Record<Lang, Labels> = {
  en: {
    title: 'Sauda order agreement',
    maker: 'Maker',
    buyer: 'Buyer',
    langName: 'English',
    item: 'Item',
    quantity: 'Quantity',
    size: 'Size',
    measurements: 'Measurements',
    color: 'Colour',
    price: 'Total price',
    deposit: 'Deposit',
    balance: 'Balance',
    delivery: 'Delivery by',
    shipping: 'Shipping',
    shippingYes: 'included in the price',
    shippingNo: 'not included in the price',
    depositWhen: 'before work starts',
    balanceWhen: 'after the buyer approves the progress photo',
    confirmed: (d) => `Both sides confirmed in their own language on ${d}`,
    termsTitle: 'Terms',
    termDeposit: (a) => `Work starts after the deposit of ${a} is paid on this invoice.`,
    termBalance: 'The balance is due after the buyer approves the progress photo.',
    termMadeToOrder: 'Made to order: no returns once cutting starts, unless the item does not match this agreement.',
  },
  hi: {
    title: 'सौदा ऑर्डर समझौता',
    maker: 'कारीगर',
    buyer: 'खरीदार',
    langName: 'हिंदी',
    item: 'सामान',
    quantity: 'मात्रा',
    size: 'साइज़',
    measurements: 'माप',
    color: 'रंग',
    price: 'कुल कीमत',
    deposit: 'एडवांस',
    balance: 'बाकी रकम',
    delivery: 'डिलीवरी',
    shipping: 'शिपिंग',
    shippingYes: 'कीमत में शामिल',
    shippingNo: 'कीमत में शामिल नहीं',
    depositWhen: 'काम शुरू होने से पहले',
    balanceWhen: 'प्रगति फ़ोटो की मंज़ूरी के बाद',
    confirmed: (d) => `दोनों पक्षों ने अपनी-अपनी भाषा में ${d} को मंज़ूरी दी`,
    termsTitle: 'शर्तें',
    termDeposit: (a) => `इस इनवॉइस पर ${a} एडवांस मिलने के बाद काम शुरू होगा।`,
    termBalance: 'खरीदार के प्रगति फ़ोटो मंज़ूर करने के बाद बाकी रकम देनी होगी।',
    termMadeToOrder: 'ऑर्डर पर बना सामान: कटिंग शुरू होने के बाद वापसी नहीं, जब तक सामान इस समझौते से मेल न खाए।',
  },
  es: {
    title: 'Acuerdo de pedido Sauda',
    maker: 'Artesano',
    buyer: 'Comprador',
    langName: 'Español',
    item: 'Artículo',
    quantity: 'Cantidad',
    size: 'Talla',
    measurements: 'Medidas',
    color: 'Color',
    price: 'Precio total',
    deposit: 'Anticipo',
    balance: 'Saldo',
    delivery: 'Entrega antes del',
    shipping: 'Envío',
    shippingYes: 'incluido en el precio',
    shippingNo: 'no incluido en el precio',
    depositWhen: 'antes de empezar el trabajo',
    balanceWhen: 'cuando el comprador apruebe la foto de avance',
    confirmed: (d) => `Ambas partes confirmaron en su propio idioma el ${d}`,
    termsTitle: 'Condiciones',
    termDeposit: (a) => `El trabajo empieza cuando se paga el anticipo de ${a} en esta factura.`,
    termBalance: 'El saldo se paga cuando el comprador apruebe la foto de avance.',
    termMadeToOrder: 'Hecho a medida: no hay devoluciones una vez empezado el corte, salvo que el artículo no coincida con este acuerdo.',
  },
};

/** PayPal limits are UTF-8 bytes, not characters (findings §6). */
export const LIMITS = { note: 4000, terms: 4000, itemDescription: 1000, itemName: 200, reference: 120 } as const;

export class AgreementTooLongError extends Error {
  constructor(
    readonly field: keyof typeof LIMITS,
    readonly bytes: number,
    readonly limit: number,
  ) {
    super(`Agreement ${field} is ${bytes} bytes; PayPal allows ${limit}`);
    this.name = 'AgreementTooLongError';
  }
}

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

function assertFits(field: keyof typeof LIMITS, text: string): string {
  const n = bytes(text);
  if (n > LIMITS[field]) throw new AgreementTooLongError(field, n, LIMITS[field]);
  return text;
}

/** Cuts text to at most maxBytes of UTF-8 without splitting a character. */
function cutToBytes(text: string, maxBytes: number): string {
  if (bytes(text) <= maxBytes) return text;
  let out = '';
  for (const ch of text) {
    if (bytes(out + ch + '…') > maxBytes) break;
    out += ch;
  }
  return out + '…';
}

const langs = (deal: Deal) => ({ m: deal.parties.maker.lang, b: deal.parties.buyer.lang });

type TextKey = { [K in keyof Labels]: Labels[K] extends string ? K : never }[keyof Labels];

/** "local label / english label" pair, maker's language first. */
function pair(deal: Deal, key: TextKey): string {
  const { m, b } = langs(deal);
  return `${LABELS[m][key]} / ${LABELS[b][key]}`;
}

function measurementsText(deal: Deal, side: Role): string {
  const lang = deal.parties[side].lang;
  return deal.terms.measurements.map((f) => `${f.value.label[side]} ${formatMeasurement(f.value, lang)}`).join('; ');
}

/** The date both sides confirmed on (the later confirmation), when both confirmed the current hash. */
function confirmedOn(deal: Deal): string | null {
  if (!bothConfirmed(deal)) return null;
  const dates = [deal.confirmations.maker!.at, deal.confirmations.buyer!.at].sort();
  return dates[1].slice(0, 10);
}

/** The bilingual agreement for the invoice note (≤ 4000 bytes). */
export function buildNote(deal: Deal): string {
  const { m, b } = langs(deal);
  const t = deal.terms;
  const d = derive(t);
  const cur = d.currency ?? 'USD';
  const lines = [
    `${LABELS[m].title} / ${LABELS[b].title} SAUDA-${deal.id}`,
    `${pair(deal, 'maker')}: ${deal.parties.maker.name} (${LABELS[m].langName})`,
    `${pair(deal, 'buyer')}: ${deal.parties.buyer.name} (${LABELS[b].langName})`,
  ];
  const terms: string[] = [];
  if (t.item) terms.push(`${pair(deal, 'item')}: ${t.item.value.maker} / ${t.item.value.buyer}`);
  if (t.quantity) terms.push(`${pair(deal, 'quantity')}: ${t.quantity.value}`);
  if (t.size) terms.push(`${pair(deal, 'size')}: ${t.size.value.maker} / ${t.size.value.buyer}`);
  if (t.measurements.length) terms.push(`${pair(deal, 'measurements')}: ${measurementsText(deal, 'maker')} / ${measurementsText(deal, 'buyer')}`);
  if (t.color) terms.push(`${pair(deal, 'color')}: ${t.color.value.maker} / ${t.color.value.buyer}`);
  if (d.totalCents !== null) terms.push(`${pair(deal, 'price')}: ${formatMoney(d.totalCents, cur)}`);
  if (d.depositCents !== null) {
    const pct = d.depositPercent !== null ? `${d.depositPercent}% = ` : '';
    terms.push(`${pair(deal, 'deposit')}: ${pct}${formatMoney(d.depositCents, cur)}, ${LABELS[m].depositWhen} / ${LABELS[b].depositWhen}`);
  }
  if (d.balanceCents !== null && d.balanceCents > 0) {
    terms.push(`${pair(deal, 'balance')}: ${formatMoney(d.balanceCents, cur)}, ${LABELS[m].balanceWhen} / ${LABELS[b].balanceWhen}`);
  }
  if (t.delivery) terms.push(`${pair(deal, 'delivery')}: ${formatDate(t.delivery.value.dateIso, m)} / ${formatDate(t.delivery.value.dateIso, b)}`);
  if (t.shippingIncluded) {
    const k = t.shippingIncluded.value ? 'shippingYes' : 'shippingNo';
    terms.push(`${pair(deal, 'shipping')}: ${LABELS[m][k]} / ${LABELS[b][k]}`);
  }
  lines.push(...terms.map((s, i) => `${i + 1}. ${s}`));
  const on = confirmedOn(deal);
  if (on) lines.push(`${LABELS[m].confirmed(formatDate(on, m))} / ${LABELS[b].confirmed(formatDate(on, b))}`);
  lines.push(`SHA-256: ${canonicalHash(deal)}`);
  return assertFits('note', lines.join('\n'));
}

/** The bilingual terms and conditions (≤ 4000 bytes). */
export function buildTerms(deal: Deal): string {
  const { m, b } = langs(deal);
  const d = derive(deal.terms);
  const cur = d.currency ?? 'USD';
  const lines = [`${LABELS[m].termsTitle} / ${LABELS[b].termsTitle}`];
  if (d.depositCents !== null) {
    const a = formatMoney(d.depositCents, cur);
    lines.push(`- ${LABELS[m].termDeposit(a)} / ${LABELS[b].termDeposit(a)}`);
  }
  if (d.balanceCents !== null && d.balanceCents > 0) lines.push(`- ${LABELS[m].termBalance} / ${LABELS[b].termBalance}`);
  lines.push(`- ${LABELS[m].termMadeToOrder} / ${LABELS[b].termMadeToOrder}`);
  return assertFits('terms', lines.join('\n'));
}

/**
 * The invoice item name, "maker / buyer" plus "× N" for N > 1. PayPal's limit is 200; it is applied
 * here as UTF-8 bytes (like the other text fields) and the name is cut rather than rejected,
 * because the note and the description carry the full terms.
 */
export function buildItemName(deal: Deal): string {
  const item = deal.terms.item?.value;
  const q = deal.terms.quantity?.value ?? 1;
  const base = item ? `${item.maker} / ${item.buyer}` : 'Sauda custom order';
  const suffix = q > 1 ? ` × ${q}` : '';
  return cutToBytes(base, LIMITS.itemName - bytes(suffix)) + suffix;
}

function describeSide(deal: Deal, side: Role): string {
  const t = deal.terms;
  return [t.size?.value[side], measurementsText(deal, side), t.color?.value[side]].filter(Boolean).join(', ');
}

/** The invoice item description: size, measurements in both units and colour, in both languages (≤ 1000 bytes). */
export function buildItemDescription(deal: Deal): string {
  const m = describeSide(deal, 'maker');
  const b = describeSide(deal, 'buyer');
  return assertFits('itemDescription', m || b ? `${m} / ${b}` : '');
}

/** The invoice reference: agreement id plus a hash prefix (≤ 120 chars). */
export function buildReference(deal: Deal): string {
  return assertFits('reference', `SAUDA-${deal.id} sha256:${canonicalHash(deal).slice(0, 16)}`);
}

/** Byte-limit problems, reported as agreement issues so they block confirmation before PayPal is called. */
export function checkTextLimits(deal: Deal): AgreementIssue[] {
  const issues: AgreementIssue[] = [];
  for (const build of [buildNote, buildTerms, buildItemDescription, buildReference]) {
    try {
      build(deal);
    } catch (e) {
      if (!(e instanceof AgreementTooLongError)) throw e;
      issues.push({ code: 'agreement_too_long', params: { field: e.field, bytes: e.bytes, limit: e.limit } });
    }
  }
  return issues;
}

const seqOf = (deal: Deal, id: string | null): number | null => (id ? (deal.messages.find((x) => x.id === id)?.seq ?? null) : null);

/** The agreement rows for one party, formatted in that party's language, each with its citation. */
export function agreementRows(deal: Deal, side: Role): AgreementRow[] {
  const lang = deal.parties[side].lang;
  const L = LABELS[lang];
  const t = deal.terms;
  const d = derive(t);
  const cur = d.currency ?? 'USD';
  const rows: AgreementRow[] = [];
  const row = (field: AgreementRow['field'], value: string, src: string | null, label?: string) =>
    rows.push({ field, value, sourceMessageId: src, seq: seqOf(deal, src), ...(label ? { label } : {}) });

  if (t.item) row('item', t.item.value[side], t.item.sourceMessageId);
  if (t.quantity) row('quantity', String(t.quantity.value), t.quantity.sourceMessageId);
  if (t.size) row('size', t.size.value[side], t.size.sourceMessageId);
  for (const f of t.measurements) row('measurement', formatMeasurement(f.value, lang), f.sourceMessageId, f.value.label[side]);
  if (t.color) row('color', t.color.value[side], t.color.sourceMessageId);
  if (t.price && d.totalCents !== null) row('price', formatMoney(d.totalCents, cur), t.price.sourceMessageId);
  if (t.deposit && d.depositCents !== null) {
    const pct = d.depositPercent !== null ? `${d.depositPercent}% · ` : '';
    row('deposit', `${pct}${formatMoney(d.depositCents, cur)}`, t.deposit.sourceMessageId);
  }
  if (d.balanceCents !== null) row('balance', formatMoney(d.balanceCents, cur), null);
  if (t.delivery) row('delivery', formatDate(t.delivery.value.dateIso, lang), t.delivery.sourceMessageId);
  if (t.shippingIncluded) row('shipping', t.shippingIncluded.value ? L.shippingYes : L.shippingNo, t.shippingIncluded.sourceMessageId);
  return rows;
}

/** Plain lines for the confirm card, in the given language (one of the two parties' languages). */
export function summaryLines(deal: Deal, lang: Lang): string[] {
  const side: Role = deal.parties.maker.lang === lang ? 'maker' : 'buyer';
  const L = LABELS[lang];
  const label: Record<AgreementRow['field'], string> = {
    item: L.item,
    quantity: L.quantity,
    size: L.size,
    measurement: L.measurements,
    color: L.color,
    price: L.price,
    deposit: L.deposit,
    balance: L.balance,
    delivery: L.delivery,
    shipping: L.shipping,
  };
  return agreementRows(deal, side).map((r) => `${r.label ?? label[r.field]}: ${r.value}`);
}
