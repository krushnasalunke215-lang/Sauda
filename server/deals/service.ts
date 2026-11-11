import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  depositPaid,
  LANGS,
  ROLES,
  type CreateDealInput,
  type Deal,
  type EventParams,
  type Lang,
  type MediaRef,
  type Message,
  type PhotoKind,
  type Role,
} from '../../shared/types.js';
import { markStale, proposeFromIntent, proposeInvoice } from '../agent/proposals.js';
import { AiBudgetError } from '../ai/budget.js';
import { AiUnavailableError } from '../ai/gemini.js';
import type { Interpreter, TurnInput, TurnResult } from '../ai/interpret.js';
import { extFor, normalizeAudioMime, normalizeImageMime, type AudioMime, type ImageMime } from '../ai/media.js';
import { TTS_VOICES, type Speak } from '../ai/tts.js';
import type { ImageInput, Vision } from '../ai/vision.js';
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
  /** null when Gemini is not configured: photos then return 503. */
  vision?: Vision | null;
  /** Uploads live in <mediaDir>/<dealId>/<messageId>.<ext>. */
  mediaDir: string;
  /** Gemini text-to-speech for playback; null when not configured (the client then uses the browser voice). */
  speak?: Speak | null;
  now?: () => Date;
  log?: Logger;
}

export interface AudioInput {
  mimeType: AudioMime;
  data: Buffer;
}

export const MAX_TEXT_CHARS = 1000;
export const MAX_NAME_CHARS = 60;
/** Per-deal caps for the public demo: messages from the parties (system events do not count) and photos. */
export const MAX_MESSAGES_PER_DEAL = 200;
export const MAX_PHOTOS_PER_DEAL = 20;

const chars = (s: string) => Array.from(s).length;

/** 409 when the deal already holds the most party messages (or photos) it may have. */
function checkCaps(d: Deal, photo: boolean): void {
  const own = d.messages.filter((m) => m.from !== 'system');
  if (own.length >= MAX_MESSAGES_PER_DEAL) throw new ServiceError(409, 'message_limit', { max: MAX_MESSAGES_PER_DEAL });
  if (photo && own.filter((m) => m.kind === 'photo').length >= MAX_PHOTOS_PER_DEAL) throw new ServiceError(409, 'photo_limit', { max: MAX_PHOTOS_PER_DEAL });
}

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
  private readonly speaking = new Map<string, Promise<Buffer>>();
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
      checkCaps(d, false);
      msg = pushMessage(d, { from: role, kind: 'text', status: 'pending', original: { text: t, lang: d.parties[role].lang } }, this.now());
    });
    this.track(this.interpretMessage(dealId, msg.id, role, { text: t }));
    return msg;
  }

  /**
   * Saves a spoken turn (an upload, a recording or a built-in sample) and interprets it in the
   * background through the same pipeline as typed turns, with the audio sent inline.
   */
  async addVoiceTurn(dealId: string, role: Role, audio: AudioInput, opts: { sample?: string } = {}): Promise<Message> {
    if (!this.deps.interpret) throw new ServiceError(503, 'ai_not_configured');
    if (!audio.data.length) throw new ServiceError(400, 'empty_audio');
    let msg!: Message;
    await this.deps.store.update(dealId, async (d) => {
      checkCaps(d, false);
      const id = `m${d.nextSeq}`;
      const media = await this.saveMedia(dealId, id, extFor(audio.mimeType), audio.data, audio.mimeType);
      msg = pushMessage(d, { from: role, kind: 'voice', status: 'pending', media, ...(opts.sample ? { sample: opts.sample } : {}) }, this.now());
    });
    this.track(this.interpretMessage(dealId, msg.id, role, { audio }));
    return msg;
  }

  /**
   * Saves a photo and has Gemini vision look at it in the background. A reference photo comes from the
   * buyer before the invoice exists; a progress photo comes from the maker once the deposit is paid.
   */
  async addPhoto(dealId: string, role: Role, kind: PhotoKind, image: ImageInput): Promise<Message> {
    if (!this.deps.vision) throw new ServiceError(503, 'ai_not_configured');
    if (!image.data.length) throw new ServiceError(400, 'empty_image');
    let msg!: Message;
    await this.deps.store.update(dealId, async (d) => {
      if (kind === 'reference') {
        if (role !== 'buyer') throw new ServiceError(403, 'buyer_only');
        if (d.invoice) throw new ServiceError(409, 'invoice_exists');
      } else {
        if (role !== 'maker') throw new ServiceError(403, 'maker_only');
        if (!depositPaid(d)) throw new ServiceError(409, 'deposit_not_paid');
      }
      checkCaps(d, true);
      const id = `m${d.nextSeq}`;
      const media = await this.saveMedia(dealId, id, extFor(image.mimeType), image.data, image.mimeType);
      msg = pushMessage(d, { from: role, kind: 'photo', status: 'pending', media, photo: { kind } }, this.now());
    });
    this.track(this.viewPhoto(dealId, msg.id, kind, image));
    return msg;
  }

  /** The buyer approves a progress photo (which the balance step requires) or asks for changes. */
  async decidePhoto(dealId: string, role: Role, messageId: string, approve: boolean): Promise<Deal> {
    return this.deps.store.update(dealId, (d) => {
      if (role !== 'buyer') throw new ServiceError(403, 'buyer_only');
      const m = findMessage(d, messageId);
      if (m.kind !== 'photo' || m.photo?.kind !== 'progress' || m.status !== 'done') throw new ServiceError(409, 'not_progress_photo');
      const now = this.now();
      m.photo.decision = { approve, at: now.toISOString() };
      if (approve) {
        d.progressApproval = { messageId, at: now.toISOString() };
        pushEvent(d, 'progress_approved', { seq: m.seq, by: role }, now);
      } else {
        if (d.progressApproval?.messageId === messageId) d.progressApproval = null;
        pushEvent(d, 'progress_changes_requested', { seq: m.seq, by: role }, now);
      }
    });
  }

  /** Re-runs a failed turn or photo of the caller's own. */
  async retryTurn(dealId: string, role: Role, messageId: string): Promise<Message> {
    let msg!: Message;
    await this.deps.store.update(dealId, (d) => {
      const m = findMessage(d, messageId);
      if (m.from !== role) throw new ServiceError(403, 'not_your_message');
      if (m.status !== 'failed') throw new ServiceError(409, 'not_failed');
      const retryable = (m.kind === 'text' && m.original) || ((m.kind === 'voice' || m.kind === 'photo') && m.media);
      if (!retryable) throw new ServiceError(409, 'cannot_retry');
      if (!(m.kind === 'photo' ? this.deps.vision : this.deps.interpret)) throw new ServiceError(503, 'ai_not_configured');
      m.status = 'pending';
      delete m.error;
      msg = structuredClone(m);
    });
    if (msg.kind === 'text') this.track(this.interpretMessage(dealId, messageId, role, { text: msg.original!.text }));
    else this.track(this.retryMedia(dealId, msg));
    return msg;
  }

  /**
   * The message's translation as speech (WAV) in the Gemini voice of its speaker (TTS_VOICES).
   * Synthesized once and cached next to the media as <messageId>.<voice>.tts.wav. The cache only
   * saves calls: when a restart wipes it (Render Free), the next request synthesizes it again.
   */
  async translationSpeech(deal: Deal, messageId: string): Promise<Buffer> {
    const speak = this.deps.speak;
    if (!speak) throw new ServiceError(503, 'tts_not_configured');
    const m = findMessage(deal, messageId);
    if (m.status !== 'done' || m.from === 'system' || !m.translation?.text) throw new ServiceError(409, 'no_translation');
    const voice = TTS_VOICES[m.from];
    const file = path.join(this.deps.mediaDir, deal.id, `${m.id}.${voice.toLowerCase()}.tts.wav`);
    const cached = await readFile(file).catch(() => null);
    if (cached) return cached;
    const key = `${deal.id}/${m.id}`;
    let job = this.speaking.get(key);
    if (!job) {
      const { text, lang } = m.translation;
      job = (async () => {
        let wav: Buffer;
        try {
          wav = await speak(text, lang, voice);
        } catch (e) {
          if (e instanceof AiBudgetError) throw new ServiceError(503, 'ai_budget');
          this.deps.log?.warn({ dealId: deal.id, messageId, err: e instanceof Error ? e.message.slice(0, 200) : String(e) }, 'tts failed');
          throw new ServiceError(502, 'tts_failed');
        }
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, wav);
        return wav;
      })().finally(() => this.speaking.delete(key));
      this.speaking.set(key, job);
    }
    return job;
  }

  /** The bytes of a stored upload. */
  async readMedia(dealId: string, file: string): Promise<Buffer> {
    return readFile(path.join(this.deps.mediaDir, dealId, file));
  }

  private async saveMedia(dealId: string, messageId: string, ext: string, data: Buffer, mimeType: string): Promise<MediaRef> {
    const dir = path.join(this.deps.mediaDir, dealId);
    await mkdir(dir, { recursive: true });
    const file = `${messageId}.${ext}`;
    await writeFile(path.join(dir, file), data);
    return { file, mimeType, bytes: data.length };
  }

  private async retryMedia(dealId: string, m: Message): Promise<void> {
    const media = m.media!;
    let data: Buffer;
    try {
      data = await this.readMedia(dealId, media.file);
    } catch {
      await this.fail(dealId, m.id, 'media_missing');
      return;
    }
    if (m.kind === 'photo') {
      const mimeType = normalizeImageMime(media.mimeType);
      if (mimeType && m.photo) return this.viewPhoto(dealId, m.id, m.photo.kind, { mimeType, data });
    } else {
      const mimeType = normalizeAudioMime(media.mimeType);
      if (mimeType && m.from !== 'system') return this.interpretMessage(dealId, m.id, m.from, { audio: { mimeType, data } });
    }
    await this.fail(dealId, m.id, 'cannot_retry');
  }

  private async fail(dealId: string, messageId: string, error: string): Promise<void> {
    await this.deps.store
      .update(dealId, (d) => {
        const m = findMessage(d, messageId);
        m.status = 'failed';
        m.error = error;
      })
      .catch(() => undefined);
  }

  /** Runs vision on a photo outside the lock, then stores the result on the message. */
  private async viewPhoto(dealId: string, messageId: string, kind: PhotoKind, image: ImageInput): Promise<void> {
    const { store } = this.deps;
    try {
      const deal = await store.update(dealId, (d) => {
        findMessage(d, messageId).status = 'interpreting';
      });
      try {
        const vision = this.deps.vision!;
        const r = kind === 'reference' ? await vision.describeReference(deal, image) : await vision.checkProgress(deal, image);
        this.deps.log?.info({ dealId, messageId, kind, ai: r.ai, attempts: r.attempts.map(({ model, ms, outcome }) => ({ model, ms, outcome })) }, 'photo viewed');
        await store.update(dealId, (d) => {
          const m = findMessage(d, messageId);
          m.status = 'done';
          m.ai = r.ai;
          m.photo = 'description' in r ? { kind, description: r.description, details: r.details } : { kind, checks: r.checks, summary: r.summary };
        });
      } catch (e) {
        const unavailable = e instanceof AiUnavailableError;
        this.deps.log?.warn({ dealId, messageId, kind, ...(unavailable ? { attempts: e.attempts } : { err: e instanceof Error ? e.message : String(e) }) }, 'photo failed');
        await this.fail(dealId, messageId, unavailable ? 'ai_unavailable' : e instanceof AiBudgetError ? 'ai_budget' : 'interpret_failed');
      }
    } catch (e) {
      this.deps.log?.warn({ dealId, messageId, err: e instanceof Error ? e.message : String(e) }, 'photo could not be saved');
    }
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
      if (bothConfirmed(d, current)) {
        pushEvent(d, 'agreement_confirmed', { hash: current.slice(0, 12) }, now);
        // The agent proposes the invoice; the maker approves it and the guards are checked again then.
        proposeInvoice(d, now);
      }
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
        } else if (e instanceof AiBudgetError) {
          error = 'ai_budget';
          this.deps.log?.warn({ dealId, messageId, limit: e.limit }, 'turn failed: AI budget used up');
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
    const after = canonicalHash(d);
    // A confirmation counts only for the hash it was given on; tell both sides when terms moved under one.
    if (confirmedBefore && after !== before) pushEvent(d, 'terms_changed', { by: m.from as Role }, now);
    if (after !== before) markStale(d, now, after);
    // The maker's spoken "shipped with DHL, tracking …" or "remind the buyer" becomes a proposal card.
    const intentWarning = proposeFromIntent(d, m, now);
    if (intentWarning) m.warnings = [...(m.warnings ?? []), intentWarning];
  }
}
