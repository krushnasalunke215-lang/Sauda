import { expect, test } from '@playwright/test';
import { createDeal, openRoles, sendText, waitForDoneMessage } from './helpers.js';

/**
 * Listen plays the Gemini voice from /tts first and falls back to the browser's own voice when that
 * request fails. Headless Chromium has no voices, so speechSynthesis is a stub that records what it
 * was asked to say.
 */
test('Listen requests /tts and falls back to the browser voice when the request fails', async ({ browser, request }) => {
  const deal = await createDeal(request);
  const { maker, buyer, close } = await openRoles(browser, deal);

  await maker.context().addInitScript(() => {
    const spoken: { text: string; lang: string }[] = [];
    const voice = { name: 'stub', lang: 'hi-IN', localService: true, default: true, voiceURI: 'stub' };
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [voice],
        speak: (u: { text: string; lang: string }) => spoken.push({ text: u.text, lang: u.lang }),
        cancel: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: function (this: { text: string; lang: string; voice: unknown }, text: string) {
        this.text = text;
        this.lang = '';
        this.voice = null;
      },
    });
    Object.defineProperty(window, '__spoken', { value: spoken });
  });
  const tts: string[] = [];
  await maker.route(/\/messages\/[^/]+\/tts(\?|$)/, (route) => {
    tts.push(route.request().url());
    return route.abort();
  });
  await maker.reload();
  await expect(maker.getByTestId('room')).toHaveAttribute('data-role', 'maker');

  await sendText(buyer, 'Hello! Can you make a light green kurta in size medium?');
  const msg = await waitForDoneMessage(maker, 'buyer');
  await msg.getByTestId('listen').click();

  await expect.poll(() => tts.length).toBe(1);
  const spoken = () => maker.evaluate(() => (window as unknown as { __spoken: { text: string; lang: string }[] }).__spoken);
  await expect.poll(async () => (await spoken()).length).toBe(1);
  const [said] = await spoken();
  expect(said.lang).toBe('hi-IN');
  // The Hindi translation, in Devanagari.
  expect(said.text).toMatch(/[\u0900-\u097F]/);
  await close();
});
