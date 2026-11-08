import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { agreementValue, createDeal, openRoles, waitForDoneMessage } from './helpers.js';

/** Runs in the 'voice' project: Chromium's fake microphone plays samples/hindi-order.m4a (as WAV). */

const DEVANAGARI = /[\u0900-\u097F]/;
const PROGRESS_PNG = fileURLToPath(new URL('./fixtures/progress.png', import.meta.url));

test('the maker speaks Hindi with push-to-talk and the buyer reads it in English', async ({ browser, request }) => {
  const deal = await createDeal(request);
  const { maker, buyer, close } = await openRoles(browser, deal, { permissions: ['microphone'] });

  const ptt = maker.getByTestId('ptt');
  await ptt.click();
  await expect(ptt).toHaveAttribute('data-recording', 'true');
  // While recording, the composer shows the live sound wave.
  await expect(maker.getByTestId('voice-stage')).toHaveAttribute('data-stage', 'recording');
  await expect(maker.getByTestId('sound-wave')).toBeVisible();
  // The clip is 23.3 s long.
  await maker.waitForTimeout(24_000);
  await ptt.click();
  await expect(ptt).toHaveAttribute('data-recording', 'false');
  await expect(maker.getByTestId('voice-stage')).toHaveAttribute('data-stage', /uploading|interpreting|done/);

  const msg = await waitForDoneMessage(buyer, 'maker');
  await expect(msg).toHaveAttribute('data-kind', 'voice');
  await expect(msg.getByTestId('message-main')).toContainText(/kurta/i);
  await expect(msg.getByTestId('message-main')).toContainText('120');
  await expect(msg.getByTestId('message-sub')).toHaveText(DEVANAGARI);
  await expect(msg.getByTestId('voice-play')).toBeVisible();

  // The maker's own bubble shows the Hindi transcript, and the original clip can be played back.
  const mine = await waitForDoneMessage(maker, 'maker');
  await expect(mine.getByTestId('message-main')).toHaveText(DEVANAGARI);
  await expect(mine.getByTestId('voice-play')).toBeVisible();

  await close();
});

test('a sample clip from the menu fills the agreement', async ({ browser, request }) => {
  const deal = await createDeal(request);
  const { maker, buyer, close } = await openRoles(browser, deal);

  // Only the maker has the Hindi sample clips.
  await expect(buyer.getByTestId('samples-menu')).toHaveCount(0);
  await maker.getByTestId('samples-menu').locator('summary').click();
  await maker.locator('[data-testid="sample-clip"][data-id="hindi-order"]').click();

  const msg = await waitForDoneMessage(buyer, 'maker');
  await expect(msg).toHaveAttribute('data-kind', 'voice');
  await expect(msg.getByTestId('sample-tag')).toBeVisible();
  await expect(msg.getByTestId('message-main')).toContainText(/kurta/i);

  for (const page of [maker, buyer]) {
    await expect(agreementValue(page, 'price')).toContainText('120.00');
    await expect(agreementValue(page, 'deposit')).toContainText('36.00');
  }
  await close();
});

test("the buyer's reference photo is described to the maker in Hindi", async ({ browser, request }) => {
  const deal = await createDeal(request);
  const { maker, buyer, close } = await openRoles(browser, deal);

  // Only the buyer can add a reference photo, and the maker has no photo button before the deposit.
  await expect(maker.getByTestId('photo-button')).toHaveCount(0);
  await expect(buyer.getByTestId('photo-button')).toHaveAttribute('data-kind', 'reference');
  await buyer.locator('[data-testid="photo-input"][data-kind="reference"]').setInputFiles(PROGRESS_PNG);

  const photo = maker.locator('[data-testid="message"][data-kind="photo"]').first();
  await expect(photo).toHaveAttribute('data-status', 'done');
  await expect(photo.getByTestId('photo-image')).toBeVisible();
  await expect(photo.getByTestId('photo-description')).toHaveText(DEVANAGARI);

  const onBuyer = buyer.locator('[data-testid="message"][data-kind="photo"]').first();
  await expect(onBuyer).toHaveAttribute('data-status', 'done');
  await expect(onBuyer.getByTestId('photo-description')).not.toHaveText(DEVANAGARI);
  await close();
});
