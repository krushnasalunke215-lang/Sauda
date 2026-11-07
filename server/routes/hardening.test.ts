import { afterEach, describe, expect, it } from 'vitest';
import type { DealView } from '../../shared/types.js';
import { AiBudgetError } from '../ai/budget.js';
import { MAX_MESSAGES_PER_DEAL, MAX_PHOTOS_PER_DEAL } from '../deals/service.js';
import { authed, testApp, type TestApp } from './test-helpers.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const turn = (a: TestApp, text = 'hello') =>
  a.app.inject({ method: 'POST', url: `/api/deals/${a.deal.id}/turns`, headers: authed(a.deal.buyer.token), payload: { text } });

describe('rate limits', () => {
  it('returns 429 rate_limited after the turn limit, per IP', async () => {
    t = await testApp({ rateLimits: { turns: { max: 2, timeWindow: '10 minutes' } } });
    expect((await turn(t)).statusCode).toBe(202);
    expect((await turn(t)).statusCode).toBe(202);
    const limited = await turn(t);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: 'rate_limited' });
    expect(limited.headers['retry-after']).toBeDefined();
    // Another client IP has its own counter.
    const other = await t.app.inject({
      method: 'POST',
      url: `/api/deals/${t.deal.id}/turns`,
      headers: authed(t.deal.buyer.token, { 'x-forwarded-for': '203.0.113.7' }),
      payload: { text: 'hello' },
    });
    expect(other.statusCode).toBe(202);
  });

  it('limits deal creation and leaves /healthz alone', async () => {
    // testApp already created one deal.
    t = await testApp({ rateLimits: { createDeal: { max: 1, timeWindow: '1 hour' }, global: { max: 3, timeWindow: '1 minute' } } });
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/deals',
      payload: { makerName: 'A', makerLang: 'hi', buyerName: 'B', buyerLang: 'en' },
    });
    expect(res.statusCode).toBe(429);
    for (let i = 0; i < 5; i++) expect((await t.app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
  });
});

describe('AI budget and per-deal caps', () => {
  it('fails the message with ai_budget when the budget is used up, and /healthz shows the count', async () => {
    t = await testApp({
      interpret: async () => {
        throw new AiBudgetError(500);
      },
      env: { AI_DAILY_CALL_LIMIT: '42' },
    });
    expect((await turn(t)).statusCode).toBe(202);
    await t.idle();
    const view = (await t.app.inject({ method: 'GET', url: `/api/deals/${t.deal.id}`, headers: authed(t.deal.buyer.token) })).json() as DealView;
    const m = view.messages.find((x) => x.from === 'buyer')!;
    expect(m).toMatchObject({ status: 'failed', error: 'ai_budget' });
    const health = (await t.app.inject({ method: 'GET', url: '/healthz' })).json();
    expect(health.ai).toMatchObject({ callsToday: 0, limit: 42 });
  });

  it('caps party messages and photos per deal with 409', async () => {
    t = await testApp();
    await t.store.update(t.deal.id, (d) => {
      for (let i = 0; i < MAX_MESSAGES_PER_DEAL; i++) {
        d.messages.push({ id: `x${i}`, seq: d.nextSeq++, from: 'buyer', kind: 'text', status: 'done', createdAt: new Date().toISOString() });
      }
    });
    const res = await turn(t);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'message_limit' });

    await t.close();
    t = await testApp();
    await t.store.update(t.deal.id, (d) => {
      for (let i = 0; i < MAX_PHOTOS_PER_DEAL; i++) {
        d.messages.push({ id: `p${i}`, seq: d.nextSeq++, from: 'buyer', kind: 'photo', status: 'done', createdAt: new Date().toISOString() });
      }
    });
    const photo = await t.app.inject({
      method: 'POST',
      url: `/api/deals/${t.deal.id}/photos?kind=reference`,
      headers: authed(t.deal.buyer.token, { 'content-type': 'image/png' }),
      payload: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    expect(photo.statusCode).toBe(409);
    expect(photo.json()).toMatchObject({ error: 'photo_limit' });
    // Text turns are still allowed: only the photo cap was reached.
    expect((await turn(t)).statusCode).toBe(202);
  });
});
