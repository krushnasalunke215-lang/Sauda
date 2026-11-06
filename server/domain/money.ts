/** Money is integer cents everywhere; strings are made only at the edge. */

export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) throw new RangeError('amount must be a finite number');
  return Math.round(amount * 100);
}

/** 12000 → "120.00" */
export function fmt(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 12000, "USD" → "$120.00"; other currencies → "EUR 120.00". */
export function formatMoney(cents: number, currency: string): string {
  return currency === 'USD' ? `$${fmt(cents)}` : `${currency} ${fmt(cents)}`;
}

/** The deposit in cents: a percent of the total (rounded to the cent) wins over a fixed amount. */
export function depositCents(totalCents: number, deposit: { percent: number | null; cents: number | null }): number | null {
  if (deposit.percent !== null) return Math.round((totalCents * deposit.percent) / 100);
  return deposit.cents;
}

export function balanceCents(totalCents: number, depositCentsValue: number): number {
  return totalCents - depositCentsValue;
}
