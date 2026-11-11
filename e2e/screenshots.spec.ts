import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { DealView, Role } from '../shared/types.js';
import { createDeal, openRoles, sendText } from './helpers.js';
import { recordPayment } from './paypal-helpers.js';

/**
 * README screenshots (docs/images/*.png). Not part of the normal e2e run: it only runs with
 * SCREENSHOTS=1, normally against the hosted app:
 *   $env:SCREENSHOTS='1'; $env:BASE_URL='https://<render-url>'; npx playwright test -c e2e/playwright.config.ts e2e/screenshots.spec.ts
 * Page screenshots never include the address bar, so the room tokens in the URLs are not captured;
 * the invite menu (which shows the buyer link) stays closed. Payments are recorded cash payments,
 * so no PayPal login screen is involved.
 */

const OUT = fileURLToPath(new URL('../docs/images/', import.meta.url));
const DESKTOP = { width: 1440, height: 900 };
const BUYER_TEXT = 'Hi! I would like a light green chikankari kurta, size medium, 44 inches long, by December 10.';
const SHIPPING_TEXT = 'Does the price include shipping to Ohio?';

test.skip(!process.env.SCREENSHOTS, 'README screenshots run on demand with SCREENSHOTS=1');

async function shot(page: Page, name: string): Promise<void> {
  // Let fonts, transitions and the Bryntum layout settle.
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}${name}.png` });
}

/** Waits until a message is interpreted, pressing Retry if the AI failed. */
async function settled(msg: Locator): Promise<void> {
  await expect
    .poll(
      async () => {
        const s = await msg.getAttribute('data-status');
        if (s === 'failed') await msg.getByTestId('retry').click();
        return s;
      },
      { timeout: 150_000, intervals: [1000] },
    )
    .toBe('done');
}

async function sendSample(maker: Page, id: string, nth: number): Promise<void> {
  await maker.getByTestId('samples-menu').locator('summary').click();
  await maker.locator(`[data-testid="sample-clip"][data-id="${id}"]`).click();
  await settled(maker.locator('[data-testid="message"][data-from="maker"]').nth(nth));
}

async function done(page: Page, from: Role, nth: number): Promise<void> {
  await expect(page.locator(`[data-testid="message"][data-from="${from}"]`).nth(nth)).toHaveAttribute('data-status', 'done');
}

test('README screenshots', async ({ browser, request }) => {
  test.setTimeout(900_000);

  // Home.
  const home = await browser.newPage({ viewport: DESKTOP });
  await home.goto('/');
  await shot(home, 'home');

  // /demo: both roles side by side, after one English and one Hindi turn.
  await home.setViewportSize({ width: 1600, height: 900 });
  await home.goto('/demo');
  const makerFrame = home.frameLocator('[data-testid="demo-maker"]');
  const buyerFrame = home.frameLocator('[data-testid="demo-buyer"]');
  await expect(makerFrame.getByTestId('room')).toHaveAttribute('data-role', 'maker');
  await expect(buyerFrame.getByTestId('room')).toHaveAttribute('data-role', 'buyer');
  await buyerFrame.getByTestId('composer-input').fill(BUYER_TEXT);
  await buyerFrame.getByTestId('composer-send').click();
  await settled(buyerFrame.locator('[data-testid="message"][data-from="buyer"]').first());
  await expect(makerFrame.locator('[data-testid="message"][data-from="buyer"]').first()).toHaveAttribute('data-status', 'done');
  await makerFrame.getByTestId('samples-menu').locator('summary').click();
  await makerFrame.locator('[data-testid="sample-clip"][data-id="hindi-order"]').click();
  await settled(makerFrame.locator('[data-testid="message"][data-from="maker"]').first());
  await expect(buyerFrame.locator('[data-testid="message"][data-from="maker"]').first()).toHaveAttribute('data-status', 'done');
  await shot(home, 'demo-split');
  await home.close();

  // The main story: maker (Hindi) and buyer (English) in two windows, in judge mode like /demo.
  const deal = await createDeal(request);
  const { maker, buyer, close } = await openRoles(browser, deal, { viewport: DESKTOP }, { judge: true });

  await sendText(buyer, BUYER_TEXT);
  await settled(buyer.locator('[data-testid="message"][data-from="buyer"]').nth(0));
  await sendSample(maker, 'hindi-order', 0);
  await done(buyer, 'maker', 0);
  // The order clip leaves shipping open; if the AI has not asked about it, the buyer does.
  const questions = buyer.locator('[data-testid="question"]');
  if ((await questions.count()) === 0) {
    await sendText(buyer, SHIPPING_TEXT);
    await settled(buyer.locator('[data-testid="message"][data-from="buyer"]').nth(1));
  }
  await expect(questions.first()).toBeVisible();

  // The full agreement list with its citations, and the open question.
  await buyer.getByTestId('agreement-expand').click();
  await expect(buyer.locator('[data-testid="agreement-row"][data-field="price"] [data-testid="citation"]')).toBeVisible();
  await buyer.getByTestId('agreement-details').scrollIntoViewIfNeeded();
  await shot(buyer, 'agreement-citations');

  // The maker answers the shipping question with the sample clip; both confirm.
  const makerTurns = await maker.locator('[data-testid="message"][data-from="maker"]').count();
  await sendSample(maker, 'shipping-answer', makerTurns);
  await done(buyer, 'maker', makerTurns);
  await buyer.getByTestId('confirm-button').click();
  await expect(buyer.getByTestId('confirm-mine')).toBeVisible();
  await maker.getByTestId('confirm-button').click();
  for (const page of [maker, buyer]) await expect(page.getByTestId('confirm-both')).toBeVisible();
  await expect(buyer.getByTestId('proposal-waiting')).toBeVisible();
  await buyer.getByTestId('confirm-card').scrollIntoViewIfNeeded();
  await shot(buyer, 'confirm');

  // The maker approves the invoice; a recorded 36.00 deposit shows the payment moment in Hindi.
  await maker.getByTestId('proposal-approve').click();
  for (const page of [maker, buyer]) await expect(page.getByTestId('payment-panel')).toHaveAttribute('data-status', 'UNPAID');
  const view = (await (await request.get(`/api/deals/${deal.id}`, { headers: { 'x-sauda-token': deal.maker.token } })).json()) as DealView;
  await recordPayment(view.invoice!.id, 3600);
  await expect(maker.getByTestId('payment-moment')).toHaveAttribute('data-kind', 'deposit', { timeout: 45_000 });
  await shot(maker, 'payment-deposit');
  await expect(buyer.getByTestId('deposit-chip')).toHaveAttribute('data-state', 'received', { timeout: 45_000 });

  // The money timeline with the PayPal debug IDs, once the buyer's payment moment has faded.
  await expect(buyer.getByTestId('payment-moment')).toHaveCount(0);
  await buyer.getByTestId('tab-timeline').click();
  await expect(buyer.locator('[data-testid="timeline-entry"][data-type="payment"][data-kind="deposit"]')).toHaveCount(1);
  await shot(buyer, 'money-timeline');
  await buyer.getByTestId('tab-deal').click();

  // The maker's sample progress photo, checked against the agreement, as the buyer sees it.
  await maker.locator('[data-testid="sample-photo"][data-kind="progress"]').click();
  await settled(maker.locator('[data-testid="message"][data-kind="photo"]').last());
  const photo = buyer.locator('[data-testid="message"][data-kind="photo"]').last();
  await expect(photo.getByTestId('photo-check').first()).toBeVisible();
  await photo.scrollIntoViewIfNeeded();
  await shot(buyer, 'progress-check');
  await buyer.getByTestId('photo-approve').click();
  await expect(buyer.getByTestId('pay-balance')).toBeVisible();

  // The maker's production board: the deposit gate done, work under way, the balance gate waiting.
  await maker.getByTestId('tab-board').click();
  await expect(maker.locator(`[data-testid="board-row-deposit_paid"][data-order="${deal.id}"]`)).toHaveAttribute('data-state', 'done');
  await shot(maker, 'board');

  await close();

  // The buyer on a phone (390 x 844), on the Pay tab with the balance button.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const mobile = await phone.newPage();
  await mobile.goto(deal.buyer.url);
  await mobile.getByTestId('mobile-tab-pay').click();
  await expect(mobile.getByTestId('pay-balance')).toBeVisible();
  await shot(mobile, 'mobile-buyer');
  await phone.close();
});
