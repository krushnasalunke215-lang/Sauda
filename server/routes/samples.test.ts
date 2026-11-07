import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DealView, SampleInfo } from '../../shared/types.js';
import type { Interpreter, TurnInput } from '../ai/interpret.js';
import { ROOT_DIR } from '../config.js';
import { authed, testApp, turnResult, type TestApp } from './test-helpers.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe('sample clips', () => {
  it('lists the samples from the manifest without file paths', async () => {
    t = await testApp();
    const list = (await t.app.inject({ method: 'GET', url: '/api/samples' })).json() as SampleInfo[];
    expect(list.map((s) => s.id)).toEqual(expect.arrayContaining(['hindi-order', 'segment-terms']));
    expect(list.find((s) => s.id === 'hindi-order')).toEqual({
      id: 'hindi-order',
      role: 'maker',
      lang: 'hi',
      kind: 'voice',
      label: { en: expect.any(String), hi: expect.stringMatching(/[\u0900-\u097F]/), es: expect.any(String) },
    });
    expect(JSON.stringify(list)).not.toContain('.m4a');
  });

  it("runs a sample through the audio pipeline for the sample's role only", async () => {
    const inputs: TurnInput[] = [];
    const interpret: Interpreter = async (_d, _s, input) => {
      inputs.push(input);
      return turnResult({ transcript: 'नमस्ते जी! आपका चिकनकारी कुर्ता…', translation: { text: 'Hello! Your chikankari kurta…', lang: 'en' } });
    };
    t = await testApp({ interpret });
    const url = (id: string) => `/api/deals/${t!.deal.id}/turns?sample=${id}`;

    const byBuyer = await t.app.inject({ method: 'POST', url: url('hindi-order'), headers: authed(t.deal.buyer.token) });
    expect(byBuyer.statusCode).toBe(403);
    expect(byBuyer.json()).toEqual({ error: 'sample_wrong_role' });
    expect((await t.app.inject({ method: 'POST', url: url('nope'), headers: authed(t.deal.maker.token) })).statusCode).toBe(404);

    const res = await t.app.inject({ method: 'POST', url: url('hindi-order'), headers: authed(t.deal.maker.token) });
    expect(res.statusCode).toBe(202);
    const { messageId } = res.json() as { messageId: string };
    await t.service.whenIdle();

    const sample = readFileSync(path.join(ROOT_DIR, 'samples', 'hindi-order.m4a'));
    expect(inputs).toHaveLength(1);
    const audio = (inputs[0] as { audio: { mimeType: string; data: Buffer } }).audio;
    expect(audio.mimeType).toBe('audio/mp4');
    expect(audio.data.equals(sample)).toBe(true);

    const v = (await t.app.inject({ method: 'GET', url: `/api/deals/${t.deal.id}`, headers: authed(t.deal.buyer.token) })).json() as DealView;
    const m = v.messages.find((x) => x.id === messageId)!;
    expect(m).toMatchObject({
      kind: 'voice',
      sample: 'hindi-order',
      status: 'done',
      media: { file: `${messageId}.m4a`, mimeType: 'audio/mp4', bytes: sample.length },
      original: { text: 'नमस्ते जी! आपका चिकनकारी कुर्ता…', lang: 'hi' },
      translation: { text: 'Hello! Your chikankari kurta…', lang: 'en' },
    });
    // The clip is the message's own copy, served like an upload.
    const served = await t.app.inject({ method: 'GET', url: `/api/deals/${t.deal.id}/media/${m.media!.file}?t=${encodeURIComponent(t.deal.buyer.token)}` });
    expect(served.headers['content-type']).toBe('audio/mp4');
    expect(served.rawPayload.equals(sample)).toBe(true);
  });

  it('serves a sample file by id, and 404 for an unknown id', async () => {
    t = await testApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/samples/hindi-order/file' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('audio/mp4');
    expect(res.rawPayload.equals(readFileSync(path.join(ROOT_DIR, 'samples', 'hindi-order.m4a')))).toBe(true);
    expect((await t.app.inject({ method: 'GET', url: '/api/samples/nope/file' })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/api/samples/..%2Fpackage/file' })).statusCode).toBe(400);
  });
});
