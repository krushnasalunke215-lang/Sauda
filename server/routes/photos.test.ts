import { afterEach, describe, expect, it } from 'vitest';
import type { DealView } from '../../shared/types.js';
import { invoice } from '../domain/test-fixtures.js';
import { authed, testApp, type TestApp } from './test-helpers.js';

const PNG = Buffer.from('89504e470d0a1a0a-fake-png-bytes');

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function setup() {
  t = await testApp();
  return t;
}

const postPhoto = (a: TestApp, kind: string, token: string, body: Buffer = PNG, type = 'image/png') =>
  a.app.inject({ method: 'POST', url: `/api/deals/${a.deal.id}/photos?kind=${kind}`, headers: authed(token, { 'content-type': type }), payload: body });

const view = async (a: TestApp, token: string) =>
  (await a.app.inject({ method: 'GET', url: `/api/deals/${a.deal.id}`, headers: authed(token) })).json() as DealView;

/** The deposit (36.00 of 120.00) is paid. */
const payDeposit = (a: TestApp) =>
  a.store.update(a.deal.id, (d) => {
    d.invoice = invoice({ status: 'PARTIALLY_PAID', paidCents: 3600, dueCents: 8400 });
  });

describe('photo routes', () => {
  it('the buyer adds a reference photo and both sides get the description', async () => {
    const a = await setup();
    const res = await postPhoto(a, 'reference', a.deal.buyer.token);
    expect(res.statusCode).toBe(202);
    const { messageId } = res.json() as { messageId: string };
    await a.service.whenIdle();
    const maker = await view(a, a.deal.maker.token);
    const m = maker.messages.find((x) => x.id === messageId)!;
    expect(m).toMatchObject({ from: 'buyer', kind: 'photo', status: 'done', media: { file: `${messageId}.png`, mimeType: 'image/png', bytes: PNG.length } });
    expect(m.photo).toMatchObject({ kind: 'reference', description: { maker: expect.stringMatching(/[\u0900-\u097F]/), buyer: 'A light green embroidered kurta' } });
  });

  it('a reference photo from the maker is 403, and after the invoice exists it is 409', async () => {
    const a = await setup();
    expect((await postPhoto(a, 'reference', a.deal.maker.token)).statusCode).toBe(403);
    await a.store.update(a.deal.id, (d) => {
      d.invoice = invoice();
    });
    const late = await postPhoto(a, 'reference', a.deal.buyer.token);
    expect(late.statusCode).toBe(409);
    expect(late.json()).toEqual({ error: 'invoice_exists' });
  });

  it('a progress photo before the deposit is paid is 409; after it, the checks are stored', async () => {
    const a = await setup();
    const early = await postPhoto(a, 'progress', a.deal.maker.token, PNG, 'image/jpeg');
    expect(early.statusCode).toBe(409);
    expect(early.json()).toEqual({ error: 'deposit_not_paid' });
    await a.store.update(a.deal.id, (d) => {
      d.invoice = invoice({ status: 'UNPAID' });
    });
    expect((await postPhoto(a, 'progress', a.deal.maker.token)).statusCode).toBe(409);

    await payDeposit(a);
    expect((await postPhoto(a, 'progress', a.deal.buyer.token)).statusCode).toBe(403);
    const ok = await postPhoto(a, 'progress', a.deal.maker.token, PNG, 'image/jpeg');
    expect(ok.statusCode).toBe(202);
    await a.service.whenIdle();
    const m = (await view(a, a.deal.buyer.token)).messages.find((x) => x.id === (ok.json() as { messageId: string }).messageId)!;
    expect(m.media?.file).toMatch(/\.jpg$/);
    expect(m.photo?.checks).toEqual([
      expect.objectContaining({ field: 'color', status: 'matches' }),
      expect.objectContaining({ field: 'measurements', status: 'cannot_verify' }),
    ]);
  });

  it('rejects other image types and a missing kind', async () => {
    const a = await setup();
    expect((await postPhoto(a, 'reference', a.deal.buyer.token, PNG, 'image/gif')).statusCode).toBe(415);
    expect((await postPhoto(a, 'nope', a.deal.buyer.token)).statusCode).toBe(400);
  });

  it('only the buyer decides on a progress photo; approval sets progressApproval', async () => {
    const a = await setup();
    await payDeposit(a);
    const { messageId } = (await postPhoto(a, 'progress', a.deal.maker.token)).json() as { messageId: string };
    await a.service.whenIdle();
    const url = `/api/deals/${a.deal.id}/photos/${messageId}/decision`;
    const byMaker = await a.app.inject({ method: 'POST', url, headers: authed(a.deal.maker.token), payload: { approve: true } });
    expect(byMaker.statusCode).toBe(403);

    const reject = await a.app.inject({ method: 'POST', url, headers: authed(a.deal.buyer.token), payload: { approve: false } });
    expect(reject.statusCode).toBe(200);
    let v = reject.json() as DealView;
    expect(v.progressApproval).toBeNull();
    expect(v.messages.find((x) => x.id === messageId)?.photo?.decision?.approve).toBe(false);
    expect(v.messages.at(-1)?.event).toEqual({ type: 'progress_changes_requested', params: { seq: expect.any(Number), by: 'buyer' } });

    const approve = await a.app.inject({ method: 'POST', url, headers: authed(a.deal.buyer.token), payload: { approve: true } });
    v = approve.json() as DealView;
    expect(v.progressApproval).toMatchObject({ messageId });
    expect(v.messages.at(-1)?.event?.type).toBe('progress_approved');

    // A reference photo cannot be "approved".
    await a.store.update(a.deal.id, (d) => {
      d.invoice = null;
    });
    const ref = (await postPhoto(a, 'reference', a.deal.buyer.token)).json() as { messageId: string };
    await a.service.whenIdle();
    const wrong = await a.app.inject({ method: 'POST', url: `/api/deals/${a.deal.id}/photos/${ref.messageId}/decision`, headers: authed(a.deal.buyer.token), payload: { approve: true } });
    expect(wrong.statusCode).toBe(409);
  });

  it('marks the photo failed when vision is unavailable, and 503 without vision', async () => {
    t = await testApp({
      vision: {
        describeReference: async () => {
          throw new Error('boom');
        },
        checkProgress: async () => {
          throw new Error('boom');
        },
      },
    });
    const { messageId } = (await postPhoto(t, 'reference', t.deal.buyer.token)).json() as { messageId: string };
    await t.service.whenIdle();
    expect((await view(t, t.deal.buyer.token)).messages.find((x) => x.id === messageId)).toMatchObject({ status: 'failed', error: 'interpret_failed' });
    await t.close();

    t = await testApp({ vision: null });
    expect((await postPhoto(t, 'reference', t.deal.buyer.token)).statusCode).toBe(503);
  });
});

describe('media serving', () => {
  it('serves a stored photo with its type for either token, and 403 for a wrong token', async () => {
    const a = await setup();
    const { messageId } = (await postPhoto(a, 'reference', a.deal.buyer.token)).json() as { messageId: string };
    await a.service.whenIdle();
    const url = (file: string, token: string) => `/api/deals/${a.deal.id}/media/${file}?t=${encodeURIComponent(token)}`;
    for (const token of [a.deal.maker.token, a.deal.buyer.token]) {
      const res = await a.app.inject({ method: 'GET', url: url(`${messageId}.png`, token) });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.rawPayload.equals(PNG)).toBe(true);
    }
    expect((await a.app.inject({ method: 'GET', url: url(`${messageId}.png`, 'x'.repeat(32)) })).statusCode).toBe(403);
    expect((await a.app.inject({ method: 'GET', url: `/api/deals/${a.deal.id}/media/${messageId}.png` })).statusCode).toBe(403);
    expect((await a.app.inject({ method: 'GET', url: url('m99.png', a.deal.buyer.token) })).statusCode).toBe(404);
  });

  it('rejects path traversal and odd file names', async () => {
    const a = await setup();
    const tok = encodeURIComponent(a.deal.buyer.token);
    for (const file of ['..%2F..%2Fsauda.db', '..%5C..%5Csauda.db', '.env', 'm1.png%00.txt', 'a.b.png', '%2E%2E']) {
      const res = await a.app.inject({ method: 'GET', url: `/api/deals/${a.deal.id}/media/${file}?t=${tok}` });
      expect([400, 404]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(200);
    }
    const dotted = await a.app.inject({ method: 'GET', url: `/api/deals/${a.deal.id}/media/..%2F..%2Fsauda.db?t=${tok}` });
    expect(dotted.json()).toEqual({ error: 'invalid_file' });
  });
});
