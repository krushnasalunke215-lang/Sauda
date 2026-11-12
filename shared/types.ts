/** Types shared by the server and the client. Money is always integer cents. */

export type Lang = 'hi' | 'en' | 'es';
export const LANGS: readonly Lang[] = ['hi', 'en', 'es'];
/** Each language's name in its own script (the home page language chips). */
export const LANG_ENDONYMS: Record<Lang, string> = { hi: 'हिंदी', en: 'English', es: 'Español' };

export type Role = 'maker' | 'buyer';
export const ROLES: readonly Role[] = ['maker', 'buyer'];
export const otherRole = (r: Role): Role => (r === 'maker' ? 'buyer' : 'maker');

/** True once the invoice shows at least the deposit paid (or the invoice paid in full). */
export function depositPaid(d: { invoice: InvoiceSnapshot | null }): boolean {
  const inv = d.invoice;
  if (!inv) return false;
  if (inv.status === 'PAID' || inv.status === 'MARKED_AS_PAID') return true;
  return inv.depositCents > 0 && inv.paidCents >= inv.depositCents;
}

/** A built-in sample (GET /api/samples). */
export interface SampleInfo {
  id: string;
  role: Role;
  lang: Lang;
  label: Record<Lang, string>;
  kind: 'voice' | 'photo';
}

/** One term written in the maker's language and in the buyer's language. */
export interface Bi {
  maker: string;
  buyer: string;
}

/** A term value plus the message that set it (its citation). */
export interface Field<T> {
  value: T;
  sourceMessageId: string;
  updatedAt: string;
}

export type Unit = 'in' | 'cm';

export interface Measurement {
  /** Lowercase English key, e.g. "length", "chest". */
  key: string;
  label: Bi;
  value: number;
  unit: Unit;
}

export interface MoneyValue {
  cents: number;
  currency: string;
}

export interface DepositTerm {
  percent: number | null;
  cents: number | null;
}

export interface DeliveryTerm {
  dateIso: string;
  spoken: string | null;
}

export interface AgreementTerms {
  item?: Field<Bi>;
  quantity?: Field<number>;
  size?: Field<Bi>;
  color?: Field<Bi>;
  measurements: Field<Measurement>[];
  /** The total price of the order. */
  price?: Field<MoneyValue>;
  deposit?: Field<DepositTerm>;
  delivery?: Field<DeliveryTerm>;
  shippingIncluded?: Field<boolean>;
}

export interface Party {
  name: string;
  lang: Lang;
}

export type MessageKind = 'text' | 'voice' | 'photo' | 'event';
export type MessageStatus = 'pending' | 'interpreting' | 'done' | 'failed';

export type EventParams = Record<string, string | number | boolean | null>;

/** Every system event type the server posts (each needs an `event.<type>` string in en, hi and es). */
export const EVENT_TYPES = [
  'deal_created',
  'confirmed',
  'agreement_confirmed',
  'terms_changed',
  'progress_approved',
  'progress_changes_requested',
  'invoice_created',
  'deposit_received',
  'balance_received',
  'paid_in_full',
  'invoice_cancelled',
  'invoice_text_changed',
  'shipped',
  'reminder_sent',
] as const;

/** A typed system event; the client renders it in the viewer's language. */
export interface SystemEvent {
  type: string;
  params: EventParams;
}

export type IntentKind = 'none' | 'add_tracking' | 'send_reminder';

export interface TurnIntent {
  kind: IntentKind;
  carrier: string | null;
  trackingNumber: string | null;
}

/** A stored upload: served at /api/deals/:id/media/:file?t=TOKEN. */
export interface MediaRef {
  file: string;
  mimeType: string;
  bytes: number;
}

export type PhotoKind = 'reference' | 'progress';
export type CheckField = 'item' | 'color' | 'size' | 'measurements' | 'other';
export const CHECK_FIELDS: readonly CheckField[] = ['item', 'color', 'size', 'measurements', 'other'];
export type CheckStatus = 'matches' | 'differs' | 'cannot_verify';
export const CHECK_STATUSES: readonly CheckStatus[] = ['matches', 'differs', 'cannot_verify'];

/** One advisory check of a progress photo against the agreement. */
export interface PhotoCheck {
  field: CheckField;
  status: CheckStatus;
  note: Bi;
}

/** What Gemini vision made of a photo (advisory), and the buyer's decision on a progress photo. */
export interface PhotoInfo {
  kind: PhotoKind;
  /** Reference photo: what it shows. */
  description?: Bi;
  details?: { aspect: string; value: Bi }[];
  /** Progress photo: per-field checks against the agreement. */
  checks?: PhotoCheck[];
  summary?: Bi;
  decision?: { approve: boolean; at: string };
}

export interface Message {
  id: string;
  seq: number;
  from: Role | 'system';
  kind: MessageKind;
  status: MessageStatus;
  /** The original voice clip or photo. */
  media?: MediaRef;
  /** Id of the built-in sample clip this voice turn came from. */
  sample?: string;
  photo?: PhotoInfo;
  /** What the speaker said or typed, in the language it was said in (a BCP-47 code). */
  original?: { text: string; lang: string };
  /** The translation into the listener's language. */
  translation?: { text: string; lang: Lang };
  ai?: { model: string; ms: number; fallback: boolean };
  event?: SystemEvent;
  intent?: TurnIntent;
  /** Codes of terms the server dropped or ignored (see i18n `warning.*`). */
  warnings?: string[];
  /** Error code when status is 'failed'. */
  error?: string;
  createdAt: string;
}

export type QuestionField =
  | 'item'
  | 'quantity'
  | 'size'
  | 'measurements'
  | 'color'
  | 'price'
  | 'deposit'
  | 'delivery'
  | 'shipping'
  | 'other';
export const QUESTION_FIELDS: readonly QuestionField[] = [
  'item', 'quantity', 'size', 'measurements', 'color', 'price', 'deposit', 'delivery', 'shipping', 'other',
];

export interface Question {
  id: string;
  field: QuestionField;
  /** The party who must answer. */
  to: Role;
  text: Bi;
  status: 'open' | 'resolved' | 'dismissed';
  /** Id of the message whose interpretation raised the question. */
  raisedBy: string;
  /** Id of the message that answered it (or the role that dismissed it). */
  resolvedBy?: string;
  createdAt: string;
}

export interface Confirmation {
  hash: string;
  at: string;
}

export interface InvoiceTransaction {
  id: string;
  type: string;
  method: string;
  cents: number;
  date: string;
}

export interface InvoiceSnapshot {
  id: string;
  number: string;
  status: string;
  payerUrl: string;
  totalCents: number;
  paidCents: number;
  dueCents: number;
  depositCents: number;
  transactions: InvoiceTransaction[];
  /** SHA-256 of the note PayPal returned. */
  noteSha256: string;
  /** True when the note and reference on PayPal still match the agreement. */
  textMatches: boolean;
}

/** True once the invoice is paid in full (PayPal checkout or recorded payments). */
export function fullyPaid(d: { invoice: InvoiceSnapshot | null }): boolean {
  const inv = d.invoice;
  if (!inv) return false;
  return inv.status === 'PAID' || inv.status === 'MARKED_AS_PAID' || (inv.totalCents > 0 && inv.paidCents >= inv.totalCents);
}

export type ProposalTool = 'create_invoice' | 'add_tracking' | 'send_reminder';
export type ProposalStatus = 'pending' | 'running' | 'done' | 'failed' | 'rejected' | 'stale';

/** Why the proposal exists, rendered in the viewer's language (i18n `proposal.reason.*`). */
export interface ProposalReason {
  code: 'both_confirmed' | 'maker_said' | 'manual';
  params: EventParams;
}

/** An action the agent proposes; code checks the guards, the maker approves, PayPal executes. */
export interface Proposal {
  id: string;
  tool: ProposalTool;
  args: Record<string, unknown>;
  status: ProposalStatus;
  reason?: ProposalReason;
  /** On success: what PayPal returned (ids). On failure: {name, message, debugId, httpStatus}. */
  result?: Record<string, unknown>;
  /** Error code when status is 'failed' (i18n `proposal.error.*`). */
  error?: string;
  createdAt: string;
  updatedAt?: string;
}

export type PaymentKind = 'deposit' | 'balance' | 'full' | 'other';

export type TimelineEntry = { id: string; at: string } & (
  | {
      type: 'paypal_call';
      label: string;
      method: string;
      path: string;
      /** null when the HTTP status is not known (the Agent Toolkit does not expose it on success). */
      status: number | null;
      debugId: string | null;
      ms: number;
      error?: string;
    }
  | { type: 'webhook'; eventId: string; eventType: string; verified: boolean; invoiceStatus: string | null }
  | { type: 'poll_change'; from: string | null; to: string; paidCents: number; source: string; debugId?: string | null }
  | { type: 'payment'; kind: PaymentKind; cents: number; txnId: string; method: string }
  | { type: 'tracking'; carrier: string; trackingNumber: string; status: string; txnIds: string[] }
  | { type: 'alert'; code: string; params: EventParams }
);

/** A timeline entry before the store gives it an id and a time. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type TimelineInput = DistributiveOmit<TimelineEntry, 'id' | 'at'>;

/** The carriers Sauda offers, as PayPal Tracking API carrier codes. */
export const CARRIERS = ['DHL', 'FEDEX', 'UPS', 'USPS', 'IND_DELHIVERY', 'IND_BLUEDART', 'DTDC_IN'] as const;
export type CarrierCode = (typeof CARRIERS)[number];

export interface TrackingInfo {
  carrier: string;
  number: string;
  transactionIds: string[];
  at: string;
}

export interface ProgressApproval {
  messageId: string;
  at: string;
}

export type Phase = 'negotiating' | 'confirmed' | 'invoiced' | 'deposit_paid' | 'paid' | 'shipped' | 'cancelled';

/** The full server state of one deal, stored as one JSON document. */
export interface Deal {
  id: string;
  createdAt: string;
  updatedAt: string;
  tokens: Record<Role, string>;
  parties: Record<Role, Party>;
  terms: AgreementTerms;
  messages: Message[];
  nextSeq: number;
  questions: Question[];
  confirmations: Partial<Record<Role, Confirmation>>;
  invoice: InvoiceSnapshot | null;
  /** What the invoice text must stay equal to: SHA-256 of the note sent to PayPal, and the reference. */
  invoiceText?: { noteSha256: string; reference: string } | null;
  proposals: Proposal[];
  timeline: TimelineEntry[];
  tracking: TrackingInfo | null;
  /** Set by the buyer's approval of the maker's progress photo (FEAT-002). */
  progressApproval: ProgressApproval | null;
  /** The poller watches the invoice until this time (FEAT-003). */
  pollUntil: string | null;
  cancelled: boolean;
}

export type RequiredField = 'item' | 'price' | 'deposit' | 'delivery';

export interface AgreementIssue {
  code: string;
  params?: EventParams;
}

export type AgreementRowField =
  | 'item'
  | 'quantity'
  | 'size'
  | 'measurement'
  | 'color'
  | 'price'
  | 'deposit'
  | 'balance'
  | 'delivery'
  | 'shipping';

/** One agreement row, already formatted in the viewer's language by the server. */
export interface AgreementRow {
  field: AgreementRowField;
  /** Label text for measurement rows (in the viewer's language); other rows use i18n labels. */
  label?: string;
  value: string;
  sourceMessageId: string | null;
  seq: number | null;
}

export interface Derived {
  currency: string | null;
  totalCents: number | null;
  depositCents: number | null;
  balanceCents: number | null;
  depositPercent: number | null;
}

export interface AgreementView {
  rows: AgreementRow[];
  derived: Derived;
  missing: RequiredField[];
  errors: AgreementIssue[];
  hash: string;
  locked: boolean;
  /** Lines for the confirm card, in the viewer's language. */
  summary: string[];
  /** The agreed delivery date (YYYY-MM-DD), for the production board. */
  deliveryDate: string | null;
}

export interface ConfirmationView {
  hash: string;
  at: string;
  /** True when this confirmation is for the current agreement hash. */
  current: boolean;
}

/** What one party sees: no tokens, and the invite link for the maker only. */
export interface DealView {
  id: string;
  role: Role;
  parties: Record<Role, Party>;
  /** The buyer's invite link (maker only). May be a path; resolve it against the page origin. */
  inviteUrl?: string;
  phase: Phase;
  agreement: AgreementView;
  messages: Message[];
  questions: Question[];
  confirmations: Record<Role, ConfirmationView | null>;
  invoice: InvoiceSnapshot | null;
  proposals: Proposal[];
  timeline: TimelineEntry[];
  tracking: TrackingInfo | null;
  progressApproval: ProgressApproval | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDealInput {
  makerName: string;
  makerLang: Lang;
  buyerName: string;
  buyerLang: Lang;
}

export interface CreateDealResult {
  id: string;
  maker: { url: string; token: string };
  buyer: { url: string; token: string };
}
