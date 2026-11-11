import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DealView } from '../../shared/types.js';
import { AiUnavailableError } from '../ai/gemini.js';
import type { Interpreter, TurnInput } from '../ai/interpret.js';
import type { Speak } from '../ai/tts.js';
import { authed, testApp, turnResult, type TestApp } from './test-helpers.js';

const OPUS = Buffer.from('1a45dfa3-fake-webm-opus');

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const getView = async (a: TestApp, token: string) =>
  (await a.app.inject({ method: 'GET', url: `/api/deals/${a.deal.id}`, headers: authed(token) })).json() as DealView;

const postAudio = (a: TestApp, token: string, type: string, body: Buffer = OPUS) =>
  a.app.inject({ method: 'POST', url: `/api/deals/${a.deal.id}/turns`, headers: authed(token, { 'content-type': type }), payload: body });

describe('voice turns', () => {
  it('saves the upload, interprets it as inline audio and stores the transcript', async () => {
    const inputs: TurnInput[] = [];
    const interpret: Interpreter = async (_d, _s, input) => {
      inputs.push(input);
      return turnResult({ transcript: 'कुल कीमत 120 डॉलर', translation: { text: 'Total price 120 dollars', lang: 'en' } });
    };
    t = await testApp({ interpret });
    const res = await postAudio(t, t.deal.maker.token, 'audio/webm;codecs=opus');
    expect(res.statusCode).toBe(202);
    const { messageId } = res.json() as { messageId: string };
    await t.service.whenIdle();
    expect(inputs).toEqual([{ audio: { mimeType: 'audio/webm', data: OPUS } }]);
    expect(existsSync(path.join(t.dataDir, 'media', t.deal.id, `${messageId}.webm`))).toBe(true);
    const m = (await getView(t, t.deal.buyer.token)).messages.find((x) => x.id === messageId)!;
    expect(m).toMatchObject({ kind: 'voice', status: 'done', media: { file: `${messageId}.webm`, mimeType: 'audio/webm' }, original: { text: 'कुल कीमत 120 डॉलर', lang: 'hi' } });
    expect(m.sample).toBeUndefined();
  });

  it('accepts WhatsApp voice notes (video/mp4) as audio/mp4 and rejects other types', async () => {
    const inputs: TurnInput[] = [];
    t = await testApp({ interpret: async (_d, _s, input) => (inputs.push(input), turnResult()) });
    expect((await postAudio(t, t.deal.maker.token, 'video/mp4')).statusCode).toBe(202);
    await t.service.whenIdle();
    expect((inputs[0] as { audio: { mimeType: string } }).audio.mimeType).toBe('audio/mp4');
    expect((await postAudio(t, t.deal.maker.token, 'audio/x-unknown')).statusCode).toBe(415);
    expect((await postAudio(t, t.deal.maker.token, 'application/octet-stream')).statusCode).toBe(415);
    expect((await postAudio(t, t.deal.maker.token, 'audio/ogg', Buffer.alloc(4 * 1024 * 1024 + 1))).statusCode).toBe(413);
    expect((await postAudio(t, 'x'.repeat(32), 'audio/ogg')).statusCode).toBe(403);
  });

  it('typed turns still work as JSON', async () => {
    t = await testApp();
    const res = await t.app.inject({ method: 'POST', url: `/api/deals/${t.deal.id}/turns`, headers: authed(t.deal.buyer.token), payload: { text: 'Hi!' } });
    expect(res.statusCode).toBe(202);
    const bad = await t.app.inject({ method: 'POST', url: `/api/deals/${t.deal.id}/turns`, headers: authed(t.deal.buyer.token), payload: { text: '' } });
    expect(bad.statusCode).toBe(400);
  });

  it('retries a failed voice turn from the stored file', async () => {
    let fail = true;
    let calls = 0;
    t = await testApp({
      interpret: async () => {
        calls++;
        if (fail) throw new AiUnavailableError('turn', []);
        return turnResult();
      },
    });
    const { messageId } = (await postAudio(t, t.deal.maker.token, 'audio/webm')).json() as { messageId: string };
    await t.service.whenIdle();
    expect((await getView(t, t.deal.maker.token)).messages.find((x) => x.id === messageId)?.status).toBe('failed');
    fail = false;
    const retry = await t.app.inject({ method: 'POST', url: `/api/deals/${t.deal.id}/turns/${messageId}/retry`, headers: authed(t.deal.maker.token) });
    expect(retry.statusCode).toBe(202);
    await t.service.whenIdle();
    expect(calls).toBe(2);
    expect((await getView(t, t.deal.maker.token)).messages.find((x) => x.id === messageId)?.status).toBe('done');
  });
});

describe('Gemini speech playback', () => {
  it("synthesizes a message's translation once in its speaker's voice and caches it", async () => {
    const calls: [string, string, string][] = [];
    const speak: Speak = async (text, lang, voice) => {
      calls.push([text, lang, voice]);
      return Buffer.from(`RIFF-fake-wav-${lang}-${voice}`);
    };
    t = await testApp({ speak });
    const { messageId } = (
      await t.app.inject({ method: 'POST', url: `/api/deals/${t.deal.id}/turns`, headers: authed(t.deal.maker.token), payload: { text: 'नमस्ते' } })
    ).json() as { messageId: string };
    await t.service.whenIdle();
    const url = (token: string) => `/api/deals/${t!.deal.id}/messages/${messageId}/tts?t=${encodeURIComponent(token)}`;
    const [a, b] = await Promise.all([t.app.inject({ method: 'GET', url: url(t.deal.buyer.token) }), t.app.inject({ method: 'GET', url: url(t.deal.buyer.token) })]);
    expect(a.statusCode).toBe(200);
    expect(a.headers['content-type']).toBe('audio/wav');
    expect(a.body).toBe('RIFF-fake-wav-en-Umbriel');
    expect(b.body).toBe('RIFF-fake-wav-en-Umbriel');
    expect((await t.app.inject({ method: 'GET', url: url(t.deal.buyer.token) })).body).toBe('RIFF-fake-wav-en-Umbriel');
    expect(calls).toEqual([['Hello', 'en', 'Umbriel']]);
    expect(existsSync(path.join(t.dataDir, 'media', t.deal.id, `${messageId}.umbriel.tts.wav`))).toBe(true);
    expect((await t.app.inject({ method: 'GET', url: url('x'.repeat(32)) })).statusCode).toBe(403);
    // The buyer's messages are read in the female voice.
    const buyerMsg = (
      await t.app.inject({ method: 'POST', url: `/api/deals/${t.deal.id}/turns`, headers: authed(t.deal.buyer.token), payload: { text: 'Hi!' } })
    ).json() as { messageId: string };
    await t.service.whenIdle();
    const res = await t.app.inject({ method: 'GET', url: `/api/deals/${t.deal.id}/messages/${buyerMsg.messageId}/tts?t=${encodeURIComponent(t.deal.maker.token)}` });
    expect(res.body).toBe('RIFF-fake-wav-en-Aoede');
    expect(calls).toEqual([
      ['Hello', 'en', 'Umbriel'],
      ['Hello', 'en', 'Aoede'],
    ]);
    // A cache lost in a restart is synthesized again.
    rmSync(path.join(t.dataDir, 'media', t.deal.id, `${messageId}.umbriel.tts.wav`));
    expect((await t.app.inject({ method: 'GET', url: url(t.deal.buyer.token) })).statusCode).toBe(200);
    expect(calls).toHaveLength(3);
    // The deal_created event has no translation.
    expect((await t.app.inject({ method: 'GET', url: `/api/deals/${t.deal.id}/messages/m1/tts?t=${encodeURIComponent(t.deal.buyer.token)}` })).statusCode).toBe(409);
  });

  it('returns 503 when TTS is not configured', async () => {
    t = await testApp();
    const { messageId } = (
      await t.app.inject({ method: 'POST', url: `/api/deals/${t.deal.id}/turns`, headers: authed(t.deal.maker.token), payload: { text: 'नमस्ते' } })
    ).json() as { messageId: string };
    await t.service.whenIdle();
    const res = await t.app.inject({ method: 'GET', url: `/api/deals/${t.deal.id}/messages/${messageId}/tts?t=${encodeURIComponent(t.deal.buyer.token)}` });
    expect(res.statusCode).toBe(503);
  });
});
