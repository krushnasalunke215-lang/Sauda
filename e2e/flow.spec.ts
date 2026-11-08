import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { DealView, Role } from '../shared/types.js';
import { agreementValue, createDeal, openRoles, sendText, waitForDoneMessage } from './helpers.js';
import { recordPayment } from './paypal-helpers.js';

/**
 * The whole deal against the PayPal sandbox, with recorded (cash) payments instead of a buyer
 * paying through checkout: negotiate, confirm, approve the invoice, deposit, progress photo,
 * balance, and the tracking card. Every assertion runs on both pages.
 */

const BUYER_TEXT = 'Hi! I would like a light green chikankari kurta, size medium, 44 inches long, by December 10.';
const PROGRESS_PNG = fileURLToPath(new URL('./fixtures/progress.png', import.meta.url));
const PAYMENT_TIMEOUT = 45_000;

/** Waits until the sender's nth message is interpreted, pressing Retry if the AI failed, then checks the other page. */
async function settle(sender: Page, viewer: Page, from: Role, nth: number): Promise<void> {
  const msg = sender.locator(`[data-testid="message"][data-from="${from}"]`).nth(nth);
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
  await waitForDoneMessage(viewer, from, nth);
}

async function showTab(page: Page, tab: 'deal' | 'timeline'): Promise<void> {
  await page.getByTestId(`tab-${tab}`).click();
  await expect(page.getByTestId(tab === 'deal' ? 'agreement' : 'timeline')).toBeVisible();
}

test('a full deal: invoice, deposit, progress photo, balance and the tracking card, with recorded payments', async ({ browser, request }) => {
  test.setTimeout(600_000);
  const deal = await createDeal(request);
  const { maker, buyer, close } = await openRoles(browser, deal);
  const pages = [maker, buyer];

  // Negotiate: the buyer's English request, then the maker's two Hindi sample clips (the order, then the shipping answer).
  await sendText(buyer, BUYER_TEXT);
  await settle(buyer, maker, 'buyer', 0);
  await maker.getByTestId('samples-menu').locator('summary').click();
  await maker.locator('[data-testid="sample-clip"][data-id="hindi-order"]').click();
  await settle(maker, buyer, 'maker', 0);
  await maker.getByTestId('samples-menu').locator('summary').click();
  await maker.locator('[data-testid="sample-clip"][data-id="shipping-answer"]').click();
  await settle(maker, buyer, 'maker', 1);
  for (const page of pages) {
    await expect(agreementValue(page, 'price')).toContainText('120.00');
    await expect(agreementValue(page, 'deposit')).toContainText('36.00');
    await expect(agreementValue(page, 'shipping')).toBeVisible();
  }

  // Both confirm; the agent proposes the invoice and only the maker can approve it.
  await expect(buyer.getByTestId('confirm-button')).toBeEnabled();
  await buyer.getByTestId('confirm-button').click();
  await expect(buyer.getByTestId('confirm-mine')).toBeVisible();
  await maker.getByTestId('confirm-button').click();
  for (const page of pages) {
    await expect(page.getByTestId('confirm-both')).toBeVisible();
    await expect(page.locator('[data-testid="proposal"][data-tool="create_invoice"]')).toHaveAttribute('data-status', 'pending');
  }
  await expect(buyer.getByTestId('proposal-approve')).toHaveCount(0);
  await expect(buyer.getByTestId('proposal-waiting')).toBeVisible();
  await maker.getByTestId('proposal-approve').click();

  for (const page of pages) {
    await expect(page.getByTestId('payment-panel')).toHaveAttribute('data-status', 'UNPAID');
    await expect(page.getByTestId('invoice-total')).toHaveText('$120.00');
    await expect(page.getByTestId('deposit-chip')).toHaveAttribute('data-state', 'pending');
    await expect(page.getByTestId('text-match')).toHaveAttribute('data-state', 'ok');
    await expect(page.getByTestId('phase')).toHaveAttribute('data-phase', 'invoiced');
    await expect(page.locator('[data-testid="proposal"][data-tool="create_invoice"]')).toHaveAttribute('data-status', 'done');
  }
  const pay = buyer.getByTestId('pay-deposit');
  await expect(pay).toHaveAttribute('href', /^https:\/\/www\.sandbox\.paypal\.com\//);
  await expect(pay).toHaveAttribute('target', '_blank');
  await expect(pay).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(buyer.getByTestId('payer-qr')).toBeVisible();
  await expect(maker.getByTestId('pay-deposit')).toHaveCount(0);

  // The money timeline lists the create and send calls with their PayPal debug IDs.
  for (const page of pages) {
    await showTab(page, 'timeline');
    for (const label of ['generate-invoice-number', 'create-invoice', 'send-invoice']) {
      await expect(page.locator(`[data-testid="timeline-entry"][data-label="${label}"]`)).toHaveAttribute('data-debug', /^[0-9a-f]{8,}$/);
    }
    await showTab(page, 'deal');
  }

  const view = (await (await request.get(`/api/deals/${deal.id}`, { headers: { 'x-sauda-token': deal.maker.token } })).json()) as DealView;
  const invoiceId = view.invoice!.id;
  expect(invoiceId).toMatch(/^INV2-/);

  // Deposit: a recorded 36.00 payment is picked up by polling on both pages.
  await recordPayment(invoiceId, 3600);
  for (const page of pages) {
    await expect(page.getByTestId('deposit-chip')).toHaveAttribute('data-state', 'received', { timeout: PAYMENT_TIMEOUT });
    await expect(page.getByTestId('phase')).toHaveAttribute('data-phase', 'deposit_paid');
    await expect(page.getByTestId('invoice-due')).toHaveText('$84.00');
  }
  await expect(buyer.getByTestId('pay-deposit')).toHaveCount(0);
  await expect(buyer.getByTestId('pay-balance')).toHaveCount(0);

  // The maker sends the progress photo, Gemini checks it (Retry if the AI failed), and the buyer approves it.
  await maker.locator('[data-testid="photo-input"][data-kind="progress"]').setInputFiles(PROGRESS_PNG);
  const makerPhoto = maker.locator('[data-testid="message"][data-kind="photo"]').last();
  await expect
    .poll(
      async () => {
        const s = await makerPhoto.getAttribute('data-status');
        if (s === 'failed') await makerPhoto.getByTestId('retry').click();
        return s;
      },
      { timeout: 150_000, intervals: [1000] },
    )
    .toBe('done');
  for (const page of pages) {
    const photo = page.locator('[data-testid="message"][data-kind="photo"]').last();
    await expect(photo).toHaveAttribute('data-status', 'done');
    await expect(photo.getByTestId('photo-check').first()).toBeVisible();
  }
  await buyer.getByTestId('photo-approve').click();
  for (const page of pages) await expect(page.getByTestId('photo-decision').last()).toHaveAttribute('data-decision', 'approved');
  await expect(buyer.getByTestId('pay-balance')).toHaveAttribute('href', /^https:\/\/www\.sandbox\.paypal\.com\//);

  // Balance: a recorded 84.00 payment pays the invoice in full on both pages. PayPal reports
  // recorded payments as MARKED_AS_PAID (checkout payments end as PAID); Sauda treats both as paid.
  await recordPayment(invoiceId, 8400);
  for (const page of pages) {
    await expect(page.getByTestId('payment-panel')).toHaveAttribute('data-status', /^(PAID|MARKED_AS_PAID)$/, { timeout: PAYMENT_TIMEOUT });
    await expect(page.getByTestId('balance-chip')).toHaveAttribute('data-state', 'received');
    await expect(page.getByTestId('phase')).toHaveAttribute('data-phase', 'paid');
    await expect(page.getByTestId('invoice-due')).toHaveText('$0.00');
  }

  // Tracking needs PayPal checkout payments; recorded payments have none, and the card says so.
  await maker.getByTestId('tracking-carrier').selectOption('DHL');
  await maker.getByTestId('tracking-number').fill('4567891234');
  await maker.getByTestId('tracking-submit').click();
  const card = (page: Page) => page.locator('[data-testid="proposal"][data-tool="add_tracking"]').first();
  await expect(card(buyer)).toHaveAttribute('data-status', 'pending');
  await card(maker).getByTestId('proposal-approve').click();
  for (const page of pages) {
    await expect(card(page)).toHaveAttribute('data-status', 'failed');
    await expect(card(page).getByTestId('proposal-error')).toHaveAttribute('data-error', 'no_paypal_payments');
  }

  // The timeline shows both payments, the PAID change, and a debug ID on every REST call.
  for (const page of pages) {
    await showTab(page, 'timeline');
    await expect(page.locator('[data-testid="timeline-entry"][data-type="payment"][data-kind="deposit"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="timeline-entry"][data-type="payment"][data-kind="balance"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="timeline-entry"][data-type="poll_change"][data-to$="PAID"]:not([data-to="PARTIALLY_PAID"])')).toHaveCount(1);
    const calls = page.locator('[data-testid="timeline-entry"][data-type="paypal_call"]');
    expect(await calls.count()).toBeGreaterThanOrEqual(5);
    for (const debug of await calls.evaluateAll((els) => els.map((e) => e.getAttribute('data-debug')))) expect(debug).toMatch(/^[0-9a-f]{8,}$/);
  }

  await close();
});
