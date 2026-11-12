import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { LANG_ENDONYMS, LANGS, type Lang } from '../shared/types.js';
import { DICTS, t } from '../client/src/i18n.js';
import { createDeal } from './helpers.js';

/**
 * The new languages without AI calls: each one opens once as the maker (desktop 1440 px and a 390 px
 * phone) and once as the buyer (390 px phone). The room shows its own strings, Japanese pages load
 * Noto Sans JP, and nothing overflows sideways at 390 px. Screenshots go to SHOTS_DIR when it is set.
 */

const PAIRS: { maker: Lang; buyer: Lang }[] = [
  { maker: 'fr', buyer: 'ja' },
  { maker: 'ja', buyer: 'pt' },
  { maker: 'pt', buyer: 'de' },
  { maker: 'de', buyer: 'fr' },
];
const NAMES: Partial<Record<Lang, string>> = { fr: 'Camille Martin', pt: 'Ana Souza', de: 'Jonas Weber', ja: 'Yuki Tanaka' };
const SHOTS = process.env.SHOTS_DIR ? `${path.resolve(process.env.SHOTS_DIR)}${path.sep}` : null;
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

async function expectOwnStrings(page: Page, lang: Lang, otherName: string): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  await expect(page.getByTestId('chat')).toContainText(DICTS[lang]['chat.empty']);
  await expect(page.getByTestId('composer-input')).toHaveAttribute('placeholder', t(lang, 'composer.placeholder', { name: otherName, lang: t(lang, `lang.${lang}`) }));
}

async function expectNoOverflow(page: Page, what: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, what).toBeLessThanOrEqual(0);
}

/** On a Japanese page: the Japanese font is loaded and is the page's font after Noto Sans. */
async function expectJapaneseFont(page: Page): Promise<void> {
  const r = await page.evaluate(async () => {
    await document.fonts.ready;
    await document.fonts.load('16px "Noto Sans JP"', '日本語の取引');
    return {
      check: document.fonts.check('16px "Noto Sans JP"', '日本語の取引'),
      loaded: [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Noto Sans JP' && f.status === 'loaded'),
      family: getComputedStyle(document.body).fontFamily,
    };
  });
  expect(r.check).toBe(true);
  expect(r.loaded).toBe(true);
  expect(r.family).toMatch(/^"?Noto Sans"?, "?Noto Sans JP"?/);
}

async function logVoices(page: Page, lang: Lang): Promise<void> {
  const voices = await page.evaluate(
    (code) =>
      new Promise<string[]>((resolve) => {
        const list = () => speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(code)).map((v) => `${v.name} (${v.lang})`);
        if (speechSynthesis.getVoices().length) return resolve(list());
        speechSynthesis.addEventListener('voiceschanged', () => resolve(list()), { once: true });
        setTimeout(() => resolve(list()), 2000);
      }),
    lang,
  );
  console.log(`browser voices for ${lang}: ${voices.length ? voices.join(', ') : 'none'}`);
}

test('the home page offers every language, each chip in its own script', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('home-lang')).toHaveCount(LANGS.length);
  for (const l of LANGS) await expect(page.locator(`[data-testid="home-lang"][data-lang="${l}"]`)).toHaveText(LANG_ENDONYMS[l]);
});

for (const { maker, buyer } of PAIRS) {
  test(`${maker} maker and ${buyer} buyer: own strings, fonts and no overflow at 390 px`, async ({ browser, request }) => {
    const deal = await createDeal(request, { makerName: NAMES[maker]!, makerLang: maker, buyerName: NAMES[buyer]!, buyerLang: buyer });
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const makerPhone = await browser.newContext(PHONE);
    const buyerPhone = await browser.newContext(PHONE);
    const m = await desktop.newPage();
    const mp = await makerPhone.newPage();
    const b = await buyerPhone.newPage();
    await m.goto(deal.maker.url);
    await mp.goto(deal.maker.url);
    await b.goto(deal.buyer.url);

    await expectOwnStrings(m, maker, NAMES[buyer]!);
    await expectOwnStrings(mp, maker, NAMES[buyer]!);
    await expectOwnStrings(b, buyer, NAMES[maker]!);
    // The buyer's sample messages are in the buyer's language.
    for (const [i, key] of (['composer.sample1', 'composer.sample2', 'composer.sample3'] as const).entries()) {
      await expect(b.locator('[data-testid="sample-text"]').nth(i)).toHaveText(DICTS[buyer][key]);
    }
    for (const [page, lang] of [[m, maker], [b, buyer]] as const) if (lang === 'ja') await expectJapaneseFont(page);

    await expectNoOverflow(mp, `${maker} maker at 390 px`);
    for (const tab of ['agreement', 'pay', 'timeline', 'chat']) {
      await b.getByTestId(`mobile-tab-${tab}`).click();
      await expect(b.getByTestId(`mobile-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
      await expectNoOverflow(b, `${buyer} buyer, ${tab} tab at 390 px`);
    }
    await logVoices(m, maker);
    await logVoices(b, buyer);

    if (SHOTS) {
      await m.screenshot({ path: `${SHOTS}lang-${maker}-desktop.png` });
      await b.screenshot({ path: `${SHOTS}lang-${buyer}-phone.png` });
    }
    await Promise.all([desktop.close(), makerPhone.close(), buyerPhone.close()]);
  });
}
