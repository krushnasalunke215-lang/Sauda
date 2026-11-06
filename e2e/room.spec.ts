import { expect, test } from '@playwright/test';
import { agreementCitation, agreementValue, createDeal, openRoles, sendText, waitForDoneMessage } from './helpers.js';

const BUYER_TEXT = 'Hi! I would like a light green chikankari kurta, size medium, 44 inches long, by December 10.';
const MAKER_TEXT =
  'नमस्ते जी! आपका चिकनकारी कुर्ता हाथ की कढ़ाई से बनेगा। साइज़ मीडियम, लंबाई 44 इंच, रंग हल्का हरा। कुल कीमत 120 डॉलर, 30 प्रतिशत एडवांस देना होगा। डिलीवरी 10 दिसंबर तक हो जाएगी।';
const DEVANAGARI = /[\u0900-\u097F]/;

test('maker (Hindi) and buyer (English) negotiate by text and both confirm the same agreement', async ({ browser, request }) => {
  const deal = await createDeal(request);
  const { maker, buyer, close } = await openRoles(browser, deal);

  await sendText(buyer, BUYER_TEXT);
  // The maker reads the buyer's English message in Hindi, with the original underneath.
  const buyerMsgOnMaker = await waitForDoneMessage(maker, 'buyer');
  await expect(buyerMsgOnMaker.getByTestId('message-main')).toHaveText(DEVANAGARI);
  await expect(buyerMsgOnMaker.getByTestId('message-sub')).toContainText('chikankari kurta');

  await sendText(maker, MAKER_TEXT);
  // The buyer reads the maker's Hindi message in English.
  const makerMsgOnBuyer = await waitForDoneMessage(buyer, 'maker');
  await expect(makerMsgOnBuyer.getByTestId('message-main')).toHaveText(/kurta/i);
  await expect(makerMsgOnBuyer.getByTestId('message-sub')).toHaveText(DEVANAGARI);
  await expect(makerMsgOnBuyer.getByTestId('model-badge')).toHaveText(/(Flash|Argon).* s$/);

  for (const page of [maker, buyer]) {
    await expect(agreementValue(page, 'price')).toContainText('120.00');
    await expect(agreementValue(page, 'deposit')).toContainText('36.00');
    await expect(agreementValue(page, 'balance')).toContainText('84.00');
    await expect(agreementCitation(page, 'price')).toBeVisible();
    await expect(agreementCitation(page, 'deposit')).toBeVisible();
  }

  // A citation chip points at the message the price came from, and highlights it.
  const seq = await agreementCitation(buyer, 'price').getAttribute('data-seq');
  await agreementCitation(buyer, 'price').click();
  await expect(buyer.locator(`#msg-${seq}`)).toHaveClass(/cite-flash/);

  await buyer.getByTestId('confirm-button').click();
  await expect(buyer.getByTestId('confirm-mine')).toBeVisible();
  await expect(maker.getByTestId('confirm-other')).toContainText('Emily Carter');
  await maker.getByTestId('confirm-button').click();

  const hashes: string[] = [];
  for (const page of [maker, buyer]) {
    await expect(page.getByTestId('confirm-both')).toBeVisible();
    await expect(page.getByTestId('phase')).toHaveAttribute('data-phase', 'confirmed');
    hashes.push((await page.getByTestId('confirm-hash').textContent()) ?? '');
  }
  expect(hashes[0]).toMatch(/^[0-9a-f]{12}$/);
  expect(hashes[1]).toBe(hashes[0]);

  await close();
});
