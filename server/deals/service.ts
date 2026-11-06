import { LANGS, ROLES, type CreateDealInput, type Deal, type EventParams, type Lang, type Message, type Role } from '../../shared/types.js';
import { AiUnavailableError } from '../ai/gemini.js';
import type { Interpreter, TurnInput, TurnResult } from '../ai/interpret.js';
import { canonicalHash, isLocked, missingRequired, patchDeal, validate } from '../domain/agreement.js';
import { checkTextLimits } from '../domain/agreement-text.js';
import { todayUtc } from '../domain/dates.js';
import { bothConfirmed } from '../domain/phase.js';
import { addQuestions, dismiss, resolveByPatch } from '../domain/questions.js';
import { makeDeal, type DealStore } from './store.js';

/** An error with an HTTP status and a stable code the client can translate. */
export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = 'ServiceError';
  }
}

export interface Logger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface ServiceDeps {
  store: DealStore;
  /** null when Gemini is not configured: turns then return 503. */
  interpret: Interpreter | null;
  now?: () => Date;
  log?: Logger;
}

export const MAX_TEXT_CHARS = 1000;
export const MAX_NAME_CHARS = 60;

const chars = (s: string) => Array.from(s).length;

function pushMessage(d: Deal, m: Omit<Message, 'id' | 'seq' | 'createdAt'>, now: Date): Message {
  const seq = d.nextSeq++;
  const msg: Message = { id: `m${seq}`, seq, createdAt: now.toISOString(), ...m };
  d.messages.push(msg);
  return msg;
}

export function pushEvent(d: Deal, type: string, params: EventParams, now: Date): Message {
  return pushMessage(d, { from: 'system', kind: 'event', status: 'done', event: { type, params } }, now);
}

function findMessage(d: Deal, id: string): Message {
  const m = d.messages.find((x) => x.id === id);
  if (!m) throw new ServiceError(404, 'message_not_found');
  return m;
}

/** Deal orchestration over the store and the interpreter. Gemini runs outside the per-deal lock. */
export class DealService {
  private readonly inflight = new Set<Promise<void>>();
  private readonly now: () => Date;

  constructor(private readonly deps: ServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  createDeal(input: unknown): Deal {
    const i = (input ?? {}) as Partial<Record<keyof CreateDealInput, unknown>>;
    const name = (v: unknown, field: string) => {
      const s = typeof v === 'string' ? v.trim() : '';
      if (chars(s) < 1 || chars(s) > MAX_NAME_CHARS) throw new ServiceError(400, 'invalid_input', { field });
      return s;
    };
    const lang = (v: unknown, field: string) => {
      if (typeof v !== 'string' || !LANGS.includes(v as Lang)) throw new ServiceError(400, 'invalid_input', { field });
      return v as Lang;
    };
    const parties = {
      maker: { name: name(i.makerName, 'makerName'), lang: lang(i.makerLang, 'makerLang') },
      buyer: { name: name(i.buyerName, 'buyerName'), lang: lang(i.buyerLang, 'buyerLang') },
    };
    if (parties.maker.lang === parties.buyer.lang) throw new ServiceError(400, 'same_language');
    const deal = makeDeal(parties, this.now());
    pushEvent(deal, 'deal_created', { maker: parties.maker.name, buyer: parties.buyer.name }, this.now());
    return this.deps.store.create(deal);
  }

  /** Appends the typed turn and starts interpreting it in the background. Returns the pending message. */
  async addTextTurn(dealId: string, role: Role, text: unknown): Promise<Message> {
    const t = typeof text === 'string' ? text.trim() : '';
    if (!t || chars(t) > MAX_TEXT_CHARS) throw new ServiceError(400, 'invalid_text', { max: MAX_TEXT_CHARS });
    if (!this.deps.interpret) throw new ServiceError(503, 'ai_not_configured');
    let msg!: Message;
    await this.deps.store.update(dealId, (d) => {
      msg = pushMessage(d, { from: role, kind: 'text', status: 'pending', original: { text: t, lang: d.parties[role].lang } }, this.now());
    });
    this.track(this.interpretMessage(dealId, msg.id, role, { text: t }));
    return msg;
  }

  /** Re-runs a failed turn of the caller's own. */
  async retryTurn(dealId: string, role: Role, messageId: string): Promise<Message> {
    if (!this.deps.interpret) throw new ServiceError(503, 'ai_not_configured');
    let input!: TurnInput;
    let msg!: Message;
    await this.deps.store.update(dealId, (d) => {
      const m = findMessage(d, messageId);
      if (m.from !== role) throw new ServiceError(403, 'not_your_message');
      if (m.status !== 'failed') throw new ServiceError(409, 'not_failed');
      if (m.kind !== 'text' || !m.original) throw new ServiceError(409, 'cannot_retry');
      m.status = 'pending';
      delete m.error;
      input = { text: m.original.text };
      msg = m;
    });
    this.track(this.interpretMessage(dealId, messageId, role, input));
    return msg;
  }

  async dismissQuestion(dealId: string, role: Role, questionId: string): Promise<Deal> {
    return this.deps.store.update(dealId, (d) => {
      const next = dismiss(d.questions, questionId, role);
      if (!next) throw new ServiceError(409, 'question_not_open');
      d.questions = next;
    });
  }

  /** Records the role's confirmation of the current agreement hash. */
  async confirm(dealId: string, role: Role, hash: unknown): Promise<Deal> {
    return this.deps.store.update(dealId, (d) => {
      const now = this.now();
      const current = canonicalHash(d);
      if (hash !== current) throw new ServiceError(409, 'stale_hash', { current });
      const missing = missingRequired(d.terms);
      const errors = [...validate(d.terms, todayUtc(now)), ...checkTextLimits(d)];
      if (missing.length || errors.length) throw new ServiceError(409, 'not_ready', { missing, errors });
      if (isLocked(d)) throw new ServiceError(409, 'agreement_locked');
      if (d.confirmations[role]?.hash === current) return;
      d.confirmations[role] = { hash: current, at: now.toISOString() };
      pushEvent(d, 'confirmed', { role }, now);
      if (bothConfirmed(d, current)) pushEvent(d, 'agreement_confirmed', { hash: current.slice(0, 12) }, now);
      // FEAT-003 adds the create_invoice proposal here.
    });
  }

  /** Resolves when no interpretation is running (tests and graceful shutdown). */
  async whenIdle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
  }

  private track(p: Promise<void>): void {
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
  }

  private async interpretMessage(dealId: string, messageId: string, role: Role, input: TurnInput): Promise<void> {
    const { store } = this.deps;
    try {
      const deal = await store.update(dealId, (d) => {
        findMessage(d, messageId).status = 'interpreting';
      });
      let result: TurnResult | null = null;
      let error = 'interpret_failed';
      try {
        result = await this.deps.interpret!(deal, role, input);
        this.deps.log?.info({ dealId, messageId, ai: result.ai, attempts: result.attempts.map(({ model, ms, outcome }) => ({ model, ms, outcome })) }, 'turn interpreted');
      } catch (e) {
        if (e instanceof AiUnavailableError) {
          error = 'ai_unavailable';
          this.deps.log?.warn({ dealId, messageId, attempts: e.attempts }, 'turn failed: AI unavailable');
        } else this.deps.log?.warn({ dealId, messageId, err: e instanceof Error ? e.message : String(e) }, 'turn failed');
      }
      await store.update(dealId, (d) => {
        const m = findMessage(d, messageId);
        if (!result) {
          m.status = 'failed';
          m.error = error;
          return;
        }
        this.applyTurn(d, m, result);
      });
    } catch (e) {
      this.deps.log?.warn({ dealId, messageId, err: e instanceof Error ? e.message : String(e) }, 'turn could not be saved');
    }
  }

  /** Applies an interpreted turn to the latest deal state (under the lock). */
  private applyTurn(d: Deal, m: Message, r: TurnResult): void {
    const now = this.now();
    const before = canonicalHash(d);
    const confirmedBefore = ROLES.some((role) => d.confirmations[role]?.hash === before);
    m.status = 'done';
    m.original = { text: r.transcript, lang: r.detectedLanguage };
    m.translation = r.translation;
    m.ai = r.ai;
    m.intent = r.intent;
    const { set, warnings } = patchDeal(d, r.patch, m.id, now, todayUtc(now));
    if (warnings.length) m.warnings = warnings;
    else delete m.warnings;
    if (!isLocked(d)) {
      d.questions = resolveByPatch(d.questions, set, m.id).questions;
      d.questions = addQuestions(d.questions, r.questions, m.id, now).questions;
    }
    // A confirmation counts only for the hash it was given on; tell both sides when terms moved under one.
    if (confirmedBefore && canonicalHash(d) !== before) pushEvent(d, 'terms_changed', { by: m.from as Role }, now);
  }
}
