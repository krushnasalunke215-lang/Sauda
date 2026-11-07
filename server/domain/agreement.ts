import { createHash } from 'node:crypto';
import type {
  AgreementIssue,
  AgreementTerms,
  Bi,
  Deal,
  Derived,
  Field,
  Measurement,
  QuestionField,
  RequiredField,
} from '../../shared/types.js';
import { isNotPast, isValidIsoDate } from './dates.js';
import { depositCents, toCents } from './money.js';

/** Terms extracted from one turn, already normalized. null / [] means "not stated in this turn". */
export interface TermsPatch {
  item: Bi | null;
  quantity: number | null;
  size: Bi | null;
  color: Bi | null;
  measurements: Measurement[];
  priceAmount: number | null;
  priceCurrency: string | null;
  depositPercent: number | null;
  depositAmount: number | null;
  deliveryDateIso: string | null;
  deliveryDateSpoken: string | null;
  shippingIncluded: boolean | null;
}

export const emptyPatch = (): TermsPatch => ({
  item: null,
  quantity: null,
  size: null,
  color: null,
  measurements: [],
  priceAmount: null,
  priceCurrency: null,
  depositPercent: null,
  depositAmount: null,
  deliveryDateIso: null,
  deliveryDateSpoken: null,
  shippingIncluded: null,
});

export function patchIsEmpty(p: TermsPatch): boolean {
  return JSON.stringify(p) === JSON.stringify(emptyPatch());
}

/** Free-text term values are cut to this many characters so a normal agreement fits PayPal's byte limits. */
export const MAX_TERM_CHARS = 120;

export function clip(s: string, max = MAX_TERM_CHARS): string {
  const chars = Array.from(s.trim());
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('');
}

const clipBi = (b: Bi): Bi => ({ maker: clip(b.maker), buyer: clip(b.buyer) });

const nonNegative = (n: number | null): boolean => n === null || (Number.isFinite(n) && n >= 0);

/** Removes values that cannot be right (negative money, bad percents, past or malformed dates, bad currencies). */
export function dropInvalid(patch: TermsPatch, today: string): { patch: TermsPatch; warnings: string[] } {
  const p = structuredClone(patch);
  const warnings: string[] = [];
  if (p.quantity !== null && !(Number.isInteger(p.quantity) && p.quantity >= 0)) {
    p.quantity = null;
    warnings.push('invalid_quantity');
  }
  if (!nonNegative(p.priceAmount)) {
    p.priceAmount = null;
    warnings.push('invalid_price');
  }
  if (p.priceCurrency !== null) {
    if (/^[A-Za-z]{3}$/.test(p.priceCurrency)) p.priceCurrency = p.priceCurrency.toUpperCase();
    else {
      p.priceCurrency = null;
      warnings.push('invalid_currency');
    }
  }
  if (p.depositPercent !== null && !(Number.isFinite(p.depositPercent) && p.depositPercent >= 0 && p.depositPercent <= 100)) {
    p.depositPercent = null;
    warnings.push('invalid_deposit_percent');
  }
  if (!nonNegative(p.depositAmount)) {
    p.depositAmount = null;
    warnings.push('invalid_deposit_amount');
  }
  if (p.deliveryDateIso !== null) {
    const bad = !isValidIsoDate(p.deliveryDateIso) ? 'invalid_delivery_date' : !isNotPast(p.deliveryDateIso, today) ? 'past_delivery_date' : null;
    if (bad) {
      warnings.push(bad);
      p.deliveryDateIso = null;
      p.deliveryDateSpoken = null;
    }
  }
  const before = p.measurements.length;
  p.measurements = p.measurements.filter((m) => Number.isFinite(m.value) && m.value > 0 && (m.unit === 'in' || m.unit === 'cm') && m.key);
  if (p.measurements.length < before) warnings.push('invalid_measurement');
  return { patch: p, warnings };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Sets every non-null term in the patch, citing messageId. A value equal to the current one keeps
 * its original citation. Returns the new terms and the fields the patch stated (for question resolution).
 */
export function applyPatch(
  terms: AgreementTerms,
  patch: TermsPatch,
  messageId: string,
  now: Date,
): { terms: AgreementTerms; set: QuestionField[] } {
  const t = structuredClone(terms);
  const set: QuestionField[] = [];
  const at = now.toISOString();
  const put = <T>(current: Field<T> | undefined, value: T): Field<T> =>
    current && same(current.value, value) ? current : { value, sourceMessageId: messageId, updatedAt: at };

  if (patch.item) {
    t.item = put(t.item, clipBi(patch.item));
    set.push('item');
  }
  if (patch.quantity !== null) {
    t.quantity = put(t.quantity, patch.quantity);
    set.push('quantity');
  }
  if (patch.size) {
    t.size = put(t.size, clipBi(patch.size));
    set.push('size');
  }
  if (patch.color) {
    t.color = put(t.color, clipBi(patch.color));
    set.push('color');
  }
  if (patch.measurements.length > 0) {
    for (const m of patch.measurements) {
      const value: Measurement = { key: m.key, label: clipBi(m.label), value: m.value, unit: m.unit };
      const i = t.measurements.findIndex((f) => f.value.key === m.key);
      if (i >= 0) t.measurements[i] = put(t.measurements[i], value);
      else t.measurements.push(put(undefined, value));
    }
    set.push('measurements');
  }
  if (patch.priceAmount !== null) {
    const currency = patch.priceCurrency ?? t.price?.value.currency ?? 'USD';
    t.price = put(t.price, { cents: toCents(patch.priceAmount), currency });
    set.push('price');
  } else if (patch.priceCurrency !== null && t.price) {
    t.price = put(t.price, { ...t.price.value, currency: patch.priceCurrency });
    set.push('price');
  }
  if (patch.depositPercent !== null) {
    t.deposit = put(t.deposit, { percent: patch.depositPercent, cents: null });
    set.push('deposit');
  } else if (patch.depositAmount !== null) {
    t.deposit = put(t.deposit, { percent: null, cents: toCents(patch.depositAmount) });
    set.push('deposit');
  }
  if (patch.deliveryDateIso !== null) {
    const spoken = patch.deliveryDateSpoken ? clip(patch.deliveryDateSpoken) : null;
    // A new spoken phrase for the same date is not a change of terms.
    t.delivery = t.delivery?.value.dateIso === patch.deliveryDateIso ? t.delivery : put(t.delivery, { dateIso: patch.deliveryDateIso, spoken });
    set.push('delivery');
  }
  if (patch.shippingIncluded !== null) {
    t.shippingIncluded = put(t.shippingIncluded, patch.shippingIncluded);
    set.push('shipping');
  }
  return { terms: t, set };
}

/**
 * The agreement is locked once an invoice exists (or is being created from it): later turns no
 * longer change the terms.
 */
export const isLocked = (deal: Deal): boolean =>
  deal.invoice !== null || (deal.proposals ?? []).some((p) => p.tool === 'create_invoice' && p.status === 'running');

/** Applies a turn's patch to the deal (mutates it) unless the agreement is locked. */
export function patchDeal(deal: Deal, patch: TermsPatch, messageId: string, now: Date, today: string): { set: QuestionField[]; warnings: string[] } {
  if (isLocked(deal)) return { set: [], warnings: patchIsEmpty(patch) ? [] : ['agreement_locked'] };
  const cleaned = dropInvalid(patch, today);
  const { terms, set } = applyPatch(deal.terms, cleaned.patch, messageId, now);
  deal.terms = terms;
  return { set, warnings: cleaned.warnings };
}

export function derive(terms: AgreementTerms): Derived {
  const total = terms.price?.value.cents ?? null;
  const dep = terms.deposit ? (total !== null ? depositCents(total, terms.deposit.value) : terms.deposit.value.cents) : null;
  const percent =
    terms.deposit?.value.percent ?? (dep !== null && total !== null && total > 0 ? Math.round((dep / total) * 1000) / 10 : null);
  return {
    currency: terms.price?.value.currency ?? null,
    totalCents: total,
    depositCents: dep,
    balanceCents: total !== null && dep !== null ? total - dep : null,
    depositPercent: terms.deposit ? percent : null,
  };
}

/** Problems that block confirmation. Sandbox invoices are USD, so the price must be in USD. */
export function validate(terms: AgreementTerms, today?: string): AgreementIssue[] {
  const issues: AgreementIssue[] = [];
  const d = derive(terms);
  if (terms.price && terms.price.value.currency !== 'USD') issues.push({ code: 'currency_not_usd', params: { currency: terms.price.value.currency } });
  if (terms.price && terms.price.value.cents <= 0) issues.push({ code: 'price_not_positive' });
  if (d.depositCents !== null && d.totalCents !== null) {
    if (d.depositCents <= 0) issues.push({ code: 'deposit_not_positive' });
    else if (d.depositCents > d.totalCents) issues.push({ code: 'deposit_exceeds_total' });
  }
  if (terms.quantity && terms.quantity.value < 1) issues.push({ code: 'quantity_below_one' });
  if (terms.delivery && today && !isNotPast(terms.delivery.value.dateIso, today)) issues.push({ code: 'delivery_in_past' });
  return issues;
}

export function missingRequired(terms: AgreementTerms): RequiredField[] {
  const missing: RequiredField[] = [];
  if (!terms.item) missing.push('item');
  if (!terms.price) missing.push('price');
  if (!terms.deposit) missing.push('deposit');
  if (!terms.delivery) missing.push('delivery');
  return missing;
}

/** JSON with object keys sorted at every level, so equal data always gives the same string. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as object)
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .sort()
          .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

/** SHA-256 of the parties, the term values (no citations) and the derived amounts. */
export function canonicalHash(deal: Deal): string {
  const t = deal.terms;
  const doc = {
    agreement: `SAUDA-${deal.id}`,
    parties: {
      maker: { name: deal.parties.maker.name, lang: deal.parties.maker.lang },
      buyer: { name: deal.parties.buyer.name, lang: deal.parties.buyer.lang },
    },
    terms: {
      item: t.item?.value ?? null,
      quantity: t.quantity?.value ?? null,
      size: t.size?.value ?? null,
      color: t.color?.value ?? null,
      measurements: t.measurements.map((m) => m.value).sort((a, b) => a.key.localeCompare(b.key)),
      price: t.price?.value ?? null,
      deposit: t.deposit?.value ?? null,
      delivery: t.delivery?.value.dateIso ?? null,
      shippingIncluded: t.shippingIncluded?.value ?? null,
    },
    derived: derive(t),
  };
  return createHash('sha256').update(canonicalJson(doc)).digest('hex');
}
