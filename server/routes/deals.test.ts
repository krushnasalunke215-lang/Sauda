import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { CreateDealResult, DealView } from '../../shared/types.js';
import type { Interpreter, TurnResult } from '../ai/interpret.js';
import { AiUnavailableError } from '../ai/gemini.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDb } from '../db.js';
import type { DealService } from '../deals/service.js';
import { DealStore } from '../deals/store.js';
import { emptyPatch } from '../domain/agreement.js';
import { SPIKE_PATCH } from '../domain/test-fixtures.js';

const config = loadConfig({ env: {}, envFile: null });

function result(over: Partial<TurnResult> = {}): TurnResult {
  return {
    transcript: '',
    detectedLanguage: 'hi',
    translation: { text: 'translated', lang: 'en' },
    patch: emptyPatch(),
    questions: [],
    intent: { kind: 'none', carrier: null, trackingNumber: null },
    ai: { model: 'fake-fast', ms: 5, fallback: false },
    attempts: [],
    ...over,
  };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function setup(interpret: Interpreter) {
  const store = new DealStore(openDb(':memory:'));
  const built = await buildApp({ config, store, interpret, staticDir: null, logger: false });
  app = built.app;
  const res = await app.inject({
    method: 'POST',
    url: '/api/deals',
    payload: { makerName: 'Asha Chikan Studio', makerLang: 'hi', buyerName: 'Emily Carter', buyerLang: 'en' },
  });
  const created = res.json() as CreateDealResult;
  return { app, service: built.service as DealService, res, created };
}

const get = (a: FastifyInstance, id: string, token: string) =>
  a.inject({ method: 'GET', url: `/api/deals/${id}`, headers: { 'x-sauda-token': token } });
const post = (a: FastifyInstance, url: string, token: string, payload?: object) =>
  a.inject({ method: 'POST', url, headers: { 'x-sauda-token': token }, ...(payload ? { payload } : {}) });

const COLOUR_CHANGE = 'रंग गहरा हरा कर दीजिए';

/** Maker states the whole spike order (or a colour change); the buyer's turns state nothing. */
const fakeInterpret: Interpreter = async (_deal, speaker, input) =>
  'text' in input && input.text === COLOUR_CHANGE
    ? result({ patch: { ...emptyPatch(), color: { maker: 'गहरा हरा', buyer: 'Dark green' } } })
    : result({
    transcript: 'text' in input ? input.text : '',
    translation: { text: `[${speaker}] translated`, lang: speaker === 'maker' ? 'en' : 'hi' },
    patch: speaker === 'maker' ? SPIKE_PATCH : emptyPatch(),
    questions:
      speaker === 'maker'
        ? [{ field: 'shipping', to: 'maker', text: { maker: 'क्या शिपिंग शामिल है?', buyer: 'Is shipping included?' } }]
        : [],
  });

describe('deal routes', () => {
  it('creates a deal and returns the maker and buyer URLs', async () => {
    const { res, created } = await setup(fakeInterpret);
    expect(res.statusCode).toBe(201);
    expect(created.maker.url).toMatch(new RegExp(`/r/${created.id}\\?t=${created.maker.token}$`));
    expect(created.buyer.url).toMatch(new RegExp(`/r/${created.id}\\?t=${created.buyer.token}$`));
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rejects bad input', async () => {
    const { app } = await setup(fakeInterpret);
    const same = await app.inject({ method: 'POST', url: '/api/deals', payload: { makerName: 'A', makerLang: 'en', buyerName: 'B', buyerLang: 'en' } });
    expect(same.statusCode).toBe(400);
    const long = await app.inject({ method: 'POST', url: '/api/deals', payload: { makerName: 'A'.repeat(61), makerLang: 'hi', buyerName: 'B', buyerLang: 'en' } });
    expect(long.statusCode).toBe(400);
  });

  it('gives each token its role view, without tokens, and 403 for a wrong token', async () => {
    const { app, created } = await setup(fakeInterpret);
    const maker = (await get(app, created.id, created.maker.token)).json() as DealView;
    const buyer = (await get(app, created.id, created.buyer.token)).json() as DealView;
    expect(maker.role).toBe('maker');
    expect(maker.inviteUrl).toContain(created.buyer.token);
    expect(buyer.role).toBe('buyer');
    expect(buyer.inviteUrl).toBeUndefined();
    expect(JSON.stringify(buyer)).not.toContain(created.maker.token);
    expect(JSON.stringify(maker)).not.toContain(created.maker.token);
    expect((await get(app, created.id, 'x'.repeat(32))).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/deals/${created.id}` })).statusCode).toBe(403);
  });

  it('a text turn fills the agreement with the message id as its citation', async () => {
    const { app, service, created } = await setup(fakeInterpret);
    const turn = await post(app, `/api/deals/${created.id}/turns`, created.maker.token, { text: 'नमस्ते जी! ...' });
    expect(turn.statusCode).toBe(202);
    const { messageId } = turn.json() as { messageId: string };
    await service.whenIdle();
    const view = (await get(app, created.id, created.buyer.token)).json() as DealView;
    const msg = view.messages.find((m) => m.id === messageId)!;
    expect(msg).toMatchObject({ status: 'done', from: 'maker', translation: { text: '[maker] translated', lang: 'en' }, ai: { model: 'fake-fast' } });
    const price = view.agreement.rows.find((r) => r.field === 'price')!;
    expect(price).toMatchObject({ value: '$120.00', sourceMessageId: messageId, seq: msg.seq });
    expect(view.agreement.rows.find((r) => r.field === 'deposit')?.value).toBe('30% · $36.00');
    expect(view.agreement.missing).toEqual([]);
    expect(view.questions).toMatchObject([{ field: 'shipping', to: 'maker', status: 'open' }]);
  });

  it('marks a turn failed when the AI is unavailable, and retries it', async () => {
    let fail = true;
    const { app, service, created } = await setup(async (deal, speaker, input) => {
      if (fail) throw new AiUnavailableError('turn', []);
      return fakeInterpret(deal, speaker, input);
    });
    const { messageId } = (await post(app, `/api/deals/${created.id}/turns`, created.buyer.token, { text: 'Hi!' })).json() as { messageId: string };
    await service.whenIdle();
    let view = (await get(app, created.id, created.buyer.token)).json() as DealView;
    expect(view.messages.find((m) => m.id === messageId)).toMatchObject({ status: 'failed', error: 'ai_unavailable' });
    expect((await post(app, `/api/deals/${created.id}/turns/${messageId}/retry`, created.maker.token)).statusCode).toBe(403);
    fail = false;
    expect((await post(app, `/api/deals/${created.id}/turns/${messageId}/retry`, created.buyer.token)).statusCode).toBe(202);
    await service.whenIdle();
    view = (await get(app, created.id, created.buyer.token)).json() as DealView;
    expect(view.messages.find((m) => m.id === messageId)?.status).toBe('done');
  });

  it('confirm with a stale hash → 409; both confirm → phase confirmed; a term change invalidates it', async () => {
    const { app, service, created } = await setup(fakeInterpret);
    const confirmUrl = `/api/deals/${created.id}/confirm`;
    const early = (await get(app, created.id, created.maker.token)).json() as DealView;
    const notReady = await post(app, confirmUrl, created.maker.token, { hash: early.agreement.hash });
    expect(notReady.statusCode).toBe(409);
    expect(notReady.json()).toMatchObject({ error: 'not_ready', details: { missing: ['item', 'price', 'deposit', 'delivery'] } });

    await post(app, `/api/deals/${created.id}/turns`, created.maker.token, { text: 'order' });
    await service.whenIdle();
    const stale = await post(app, confirmUrl, created.maker.token, { hash: early.agreement.hash });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'stale_hash' });

    const { hash } = ((await get(app, created.id, created.maker.token)).json() as DealView).agreement;
    const m = (await post(app, confirmUrl, created.maker.token, { hash })).json() as DealView;
    expect(m.phase).toBe('negotiating');
    expect(m.confirmations.maker).toMatchObject({ hash, current: true });
    const b = (await post(app, confirmUrl, created.buyer.token, { hash })).json() as DealView;
    expect(b.phase).toBe('confirmed');
    expect(b.messages.filter((x) => x.event).map((x) => x.event!.type)).toEqual(['deal_created', 'confirmed', 'confirmed', 'agreement_confirmed']);

    // The maker changes the colour: both confirmations no longer match.
    await post(app, `/api/deals/${created.id}/turns`, created.maker.token, { text: COLOUR_CHANGE });
    await service.whenIdle();
    const again = (await get(app, created.id, created.buyer.token)).json() as DealView;
    expect(again.phase).toBe('negotiating');
    expect(again.confirmations.buyer?.current).toBe(false);
    expect(again.messages.at(-1)?.event?.type).toBe('terms_changed');
  });

  it('dismisses an open question once', async () => {
    const { app, service, created } = await setup(fakeInterpret);
    await post(app, `/api/deals/${created.id}/turns`, created.maker.token, { text: 'order' });
    await service.whenIdle();
    const url = `/api/deals/${created.id}/questions/q1/dismiss`;
    const v = (await post(app, url, created.buyer.token)).json() as DealView;
    expect(v.questions[0]).toMatchObject({ status: 'dismissed', resolvedBy: 'buyer' });
    expect((await post(app, url, created.buyer.token)).statusCode).toBe(409);
  });

  it('returns 503 for turns when Gemini is not configured', async () => {
    const store = new DealStore(openDb(':memory:'));
    const built = await buildApp({ config, store, interpret: null, staticDir: null, logger: false });
    app = built.app;
    const created = (
      await app.inject({ method: 'POST', url: '/api/deals', payload: { makerName: 'A', makerLang: 'hi', buyerName: 'B', buyerLang: 'en' } })
    ).json() as CreateDealResult;
    const res = await post(app, `/api/deals/${created.id}/turns`, created.maker.token, { text: 'hi' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'ai_not_configured' });
  });

  it('serves /healthz', async () => {
    const { app } = await setup(fakeInterpret);
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.json()).toEqual({ ok: true, commit: 'local', ai: { fastModel: 'gemini-3.8-flash', fallbackModel: 'gemini-4-argon' } });
  });
});

