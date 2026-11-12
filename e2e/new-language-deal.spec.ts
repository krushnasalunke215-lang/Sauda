import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { DealView, Lang } from '../shared/types.js';
import { DICTS } from '../client/src/i18n.js';
import { LABELS } from '../server/domain/agreement-text.js';
import { agreementValue, createDeal, expectBoard, openRoles, sendText, settle, showTab } from './helpers.js';
import { invoiceNote, recordPayment } from './paypal-helpers.js';

/**
 * The whole deal in a pair of newly added languages (video shot 15): a Japanese maker and a French
 * buyer, typed turns, against the PayPal sandbox with recorded payments, from the first message to
 * paid in full and the tracking card.
 */

const PAIR = { maker: 'ja', buyer: 'fr' } as const satisfies { maker: Lang; buyer: Lang };
const MAKER_TERMS = 'はい、薄い緑色のチカンカリのクルタをお作りできます。サイズはM、丈は44インチです。合計金額は120ドルで、作業開始前に30パーセントの前金をお願いします。12月10日までにお届けします。';
const MAKER_SHIPPING = 'はい、オハイオまでの送料は120ドルに含まれています。';
const JAPANESE = /[\u3040-\u30FF]/;
const LATIN = /^[^\u3040-\u30FF\u4E00-\u9FFF]*[A-Za-zÀ-ÿ][^\u3040-\u30FF\u4E00-\u9FFF]*$/s;
const PAYMENT_TIMEOUT = 45_000;
const SHOTS = process.env.SHOTS_DIR ? `${path.resolve(process.env.SHOTS_DIR)}${path.sep}` : null;

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}${name}.png` });
}

test('a full deal in a new language pair: Japanese maker, French buyer', async ({ browser, request }) => {
  test.setTimeout(600_000);
  const deal = await createDeal(request, { makerName: 'Yuki Tanaka', makerLang: PAIR.maker, buyerName: 'Camille Martin', buyerLang: PAIR.buyer });
  const { maker, buyer, close } = await openRoles(browser, deal, { viewport: { width: 1440, height: 900 } });
  const pages = [maker, buyer];
  const view = async () => (await (await request.get(`/api/deals/${deal.id}`, { headers: { 'x-sauda-token': deal.maker.token } })).json()) as DealView;

  // Negotiate by text: the buyer's French sample, the maker's Japanese terms, the buyer's shipping question, the maker's answer.
  await sendText(buyer, DICTS.fr['composer.sample1']);
  await settle(buyer, maker, 'buyer', 0);
  const first = maker.locator('[data-testid="message"][data-from="buyer"]').first();
  await expect(first.getByTestId('message-main')).toHaveText(JAPANESE);
  await expect(first.getByTestId('message-sub')).toHaveText(LATIN);

  await sendText(maker, MAKER_TERMS);
  await settle(maker, buyer, 'maker', 0);
  const terms = buyer.locator('[data-testid="message"][data-from="maker"]').first();
  await expect(terms.getByTestId('message-main')).toHaveText(LATIN);
  await expect(terms.getByTestId('message-sub')).toHaveText(JAPANESE);

  await sendText(buyer, DICTS.fr['composer.sample2']);
  await settle(buyer, maker, 'buyer', 1);
  // The shipping question is raised for the maker, in Japanese for the maker and in French for the buyer.
  const q = (page: Page) => page.locator('[data-testid="question"][data-field="shipping"]');
  await expect(q(maker).first()).toBeVisible();
  await expect(q(maker).first().getByTestId('question-text')).toHaveText(JAPANESE);
  await expect(q(buyer).first().getByTestId('question-text')).toHaveText(LATIN);

  await sendText(maker, MAKER_SHIPPING);
  await settle(maker, buyer, 'maker', 1);
  for (const page of pages) {
    await expect(q(page)).toHaveCount(0);
    await expect(page.locator('[data-testid="question-closed"][data-status="resolved"]')).not.toHaveCount(0);
    await expect(agreementValue(page, 'price')).toContainText('120.00');
    await expect(agreementValue(page, 'deposit')).toContainText('36.00');
    await expect(agreementValue(page, 'shipping')).toHaveCount(1);
    await expect(page.locator('[data-testid="agreement-line"][data-group="delivery"]')).toHaveAttribute('data-filled', 'true');
  }
  await expect(maker.locator('[data-testid="agreement-line"][data-group="delivery"]')).toContainText('12月10日');
  await expect(buyer.locator('[data-testid="agreement-line"][data-group="delivery"]')).toContainText('10 décembre');
  await shot(maker, 'pair-ja-maker-agreement');
  await shot(buyer, 'pair-fr-buyer-agreement');

  // Confirm, approve the invoice.
  await buyer.getByTestId('confirm-button').click();
  await expect(buyer.getByTestId('confirm-mine')).toBeVisible();
  await maker.getByTestId('confirm-button').click();
  for (const page of pages) await expect(page.locator('[data-testid="proposal"][data-tool="create_invoice"]')).toHaveAttribute('data-status', 'pending');
  await maker.getByTestId('proposal-approve').click();
  for (const page of pages) {
    await expect(page.getByTestId('payment-panel')).toHaveAttribute('data-status', 'UNPAID');
    await expect(page.getByTestId('invoice-total')).toHaveText('$120.00');
    await expect(page.getByTestId('text-match')).toHaveAttribute('data-state', 'ok');
    await expect(page.getByTestId('pay-badge')).toHaveAttribute('data-state', 'invoiced');
  }
  await expect(buyer.getByTestId('your-turn')).toHaveAttribute('data-action', 'payDeposit');
  await expect(buyer.getByTestId('pay-deposit')).toHaveAttribute('href', /^https:\/\/www\.sandbox\.paypal\.com\//);
  await shot(buyer, 'pair-fr-buyer-invoice');

  // PayPal stores the bilingual note: Japanese and French labels, both long dates.
  const invoiceId = (await view()).invoice!.id;
  expect(invoiceId).toMatch(/^INV2-/);
  const note = await invoiceNote(invoiceId);
  expect(note).toContain(LABELS.ja.title);
  expect(note).toContain(LABELS.fr.title);
  expect(note).toContain('2026年12月10日');

  // Deposit, then the board in Japanese.
  await recordPayment(invoiceId, 3600);
  for (const page of pages) {
    await expect(page.getByTestId('deposit-chip')).toHaveAttribute('data-state', 'received', { timeout: PAYMENT_TIMEOUT });
    await expect(page.getByTestId('invoice-due')).toHaveText('$84.00');
    await expect(page.getByTestId('pay-badge')).toHaveAttribute('data-state', 'deposit_paid');
  }
  await expect(maker.getByTestId('your-turn')).toHaveAttribute('data-action', 'sendPhoto');
  await showTab(maker, 'board');
  await expect(maker.getByTestId('board')).toContainText(DICTS.ja['board.state.done']);
  await shot(maker, 'pair-ja-maker-board');
  await expectBoard(maker, deal.id, { deposit_paid: 'done', cutting_embroidery: 'ready', balance_paid: 'ready', pack_ship: 'locked' });

  // Progress photo: the checks read in Japanese for the maker and in French for the buyer.
  await maker.locator('[data-testid="sample-photo"][data-kind="progress"]').click();
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
  const photoCheck = (page: Page) => page.locator('[data-testid="message"][data-kind="photo"]').last().getByTestId('photo-check').first();
  await expect(photoCheck(maker)).toHaveText(JAPANESE);
  await expect(photoCheck(buyer)).toHaveText(LATIN);
  await buyer.getByTestId('photo-approve').click();
  for (const page of pages) await expect(page.getByTestId('pay-badge')).toHaveAttribute('data-state', 'balance_due');

  // Balance: paid in full.
  await recordPayment(invoiceId, 8400);
  for (const page of pages) {
    await expect(page.getByTestId('payment-panel')).toHaveAttribute('data-status', /^(PAID|MARKED_AS_PAID)$/, { timeout: PAYMENT_TIMEOUT });
    await expect(page.getByTestId('phase')).toHaveAttribute('data-phase', 'paid');
    await expect(page.getByTestId('pay-badge')).toHaveAttribute('data-state', 'paid');
  }
  await expectBoard(maker, deal.id, { cutting_embroidery: 'done', balance_paid: 'done', pack_ship: 'ready' });
  await shot(buyer, 'pair-fr-buyer-paid');

  // The tracking card (recorded payments have no PayPal checkout payment, and the card says so).
  await maker.getByTestId('tracking-carrier').selectOption('DHL');
  await maker.getByTestId('tracking-number').fill('4567891234');
  await maker.getByTestId('tracking-submit').click();
  const card = (page: Page) => page.locator('[data-testid="proposal"][data-tool="add_tracking"]').first();
  await card(maker).getByTestId('proposal-approve').click();
  for (const page of pages) await expect(card(page).getByTestId('proposal-error')).toHaveAttribute('data-error', 'no_paypal_payments');

  // The money timeline in both languages: both payments recorded.
  for (const page of pages) {
    await showTab(page, 'timeline');
    await expect(page.locator('[data-testid="timeline-entry"][data-type="payment"][data-kind="deposit"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="timeline-entry"][data-type="payment"][data-kind="balance"]')).toHaveCount(1);
    await showTab(page, 'deal');
  }

  // Spoken playback: /tts reads one message to each side as WAV.
  const final = await view();
  const fromBuyer = final.messages.find((m) => m.from === 'buyer' && m.translation)!;
  const fromMaker = final.messages.find((m) => m.from === 'maker' && m.translation)!;
  for (const [m, token] of [[fromBuyer, deal.maker.token], [fromMaker, deal.buyer.token]] as const) {
    const res = await request.get(`/api/deals/${deal.id}/messages/${m.id}/tts?t=${encodeURIComponent(token)}`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/^audio\/wav/);
    expect((await res.body()).length).toBeGreaterThan(1000);
  }

  await close();
});
