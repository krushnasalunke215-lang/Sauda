/**
 * The three small pictures of the home page's "how it works" steps, drawn in the icon style
 * (rounded shapes, 1.75 strokes, stone lines with emerald for done and money). No words inside:
 * the letters अ and A stand for the two languages.
 */

const SIZE = { width: 120, height: 80, viewBox: '0 0 120 80' } as const;

/** Talk in your language: a Hindi bubble and an English bubble. */
export function TalkArt() {
  return (
    <svg {...SIZE} aria-hidden fill="none" strokeWidth={1.75} strokeLinejoin="round">
      <path d="M22 10h40a10 10 0 0 1 10 10v14a10 10 0 0 1-10 10H32l-10 8v-8a10 10 0 0 1-10-10V20a10 10 0 0 1 10-10z" className="fill-stone-100 stroke-stone-300" />
      <text x="42" y="34" textAnchor="middle" fontSize="18" fontWeight="600" className="fill-stone-700">
        अ
      </text>
      <path d="M58 30h40a10 10 0 0 1 10 10v14a10 10 0 0 1-10 10v8l-10-8H58a10 10 0 0 1-10-10V40a10 10 0 0 1 10-10z" className="fill-emerald-50 stroke-emerald-600" />
      <text x="78" y="54" textAnchor="middle" fontSize="18" fontWeight="600" className="fill-emerald-800">
        A
      </text>
    </svg>
  );
}

/** Agree together: one agreement with a check. */
export function AgreeArt() {
  return (
    <svg {...SIZE} aria-hidden fill="none" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="32" y="8" width="56" height="64" rx="8" className="fill-white stroke-stone-300" />
      <path d="M42 24h34M42 35h26M42 46h30" strokeWidth={3} className="stroke-stone-300" />
      <circle cx="86" cy="60" r="13" className="fill-emerald-600" />
      <path d="M80 60.5l4 4 8-8.5" strokeWidth={2.5} className="stroke-white" />
    </svg>
  );
}

/** Get paid with PayPal: an invoice with the deposit paid. */
export function PaidArt() {
  return (
    <svg {...SIZE} aria-hidden fill="none" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="16" y="14" width="76" height="52" rx="8" className="fill-white stroke-stone-300" />
      <text x="34" y="46" textAnchor="middle" fontSize="20" fontWeight="700" className="fill-stone-700">
        $
      </text>
      <rect x="46" y="36" width="34" height="6" rx="3" className="fill-stone-200" />
      <rect x="46" y="36" width="12" height="6" rx="3" className="fill-emerald-600" />
      <circle cx="92" cy="60" r="13" className="fill-emerald-600" />
      <path d="M86 60.5l4 4 8-8.5" strokeWidth={2.5} className="stroke-white" />
    </svg>
  );
}
