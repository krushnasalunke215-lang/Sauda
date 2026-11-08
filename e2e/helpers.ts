import { expect, type APIRequestContext, type Browser, type BrowserContextOptions, type Locator, type Page } from '@playwright/test';
import type { CreateDealInput, CreateDealResult, Role } from '../shared/types.js';

export const DEFAULT_DEAL: CreateDealInput = { makerName: 'Ravi Chikan Studio', makerLang: 'hi', buyerName: 'Emily Carter', buyerLang: 'en' };

export async function createDeal(request: APIRequestContext, input: Partial<CreateDealInput> = {}): Promise<CreateDealResult> {
  const res = await request.post('/api/deals', { data: { ...DEFAULT_DEAL, ...input } });
  expect(res.status()).toBe(201);
  return (await res.json()) as CreateDealResult;
}

/**
 * Opens the maker and the buyer in two separate browser contexts (two windows). `judge: true` opens
 * both in judge mode, which shows the technical labels (model badges, message numbers, hashes).
 */
export async function openRoles(
  browser: Browser,
  deal: CreateDealResult,
  contextOptions: BrowserContextOptions = {},
  opts: { judge?: boolean } = {},
): Promise<{ maker: Page; buyer: Page; close: () => Promise<void> }> {
  const contexts = [await browser.newContext(contextOptions), await browser.newContext(contextOptions)];
  const [maker, buyer] = await Promise.all(contexts.map((c) => c.newPage()));
  const url = (u: string) => (opts.judge ? `${u}&judge=1` : u);
  await maker.goto(url(deal.maker.url));
  await buyer.goto(url(deal.buyer.url));
  await expect(maker.getByTestId('room')).toHaveAttribute('data-role', 'maker');
  await expect(buyer.getByTestId('room')).toHaveAttribute('data-role', 'buyer');
  return { maker, buyer, close: async () => void (await Promise.all(contexts.map((c) => c.close()))) };
}

export async function sendText(page: Page, text: string): Promise<void> {
  await page.getByTestId('composer-input').fill(text);
  await page.getByTestId('composer-send').click();
  await expect(page.getByTestId('composer-input')).toHaveValue('');
}

/** The nth message from a role, once it has been interpreted. */
export async function waitForDoneMessage(page: Page, from: Role, nth = 0): Promise<Locator> {
  const msg = page.locator(`[data-testid="message"][data-from="${from}"]`).nth(nth);
  await expect(msg).toHaveAttribute('data-status', 'done');
  return msg;
}

export function agreementValue(page: Page, field: string): Locator {
  return page.locator(`[data-testid="agreement-row"][data-field="${field}"] [data-testid="agreement-value"]`);
}

export function agreementCitation(page: Page, field: string): Locator {
  return page.locator(`[data-testid="agreement-row"][data-field="${field}"] [data-testid="citation"]`);
}
