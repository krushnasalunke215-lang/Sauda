/**
 * Live smoke test of the turn interpreter: real Gemini calls with the settings from .env.
 *   npm run smoke:gemini
 *   npm run smoke:gemini -- --audio=<file>   (one spoken maker turn; MIME type from the extension)
 * Prints only the model, timing, fallback, schema validity, translation and extracted terms (never keys).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AiUnavailableError, createGenAI, sdkCallModel } from '../server/ai/gemini.js';
import { interpretTurn, type TurnInput, type TurnResult } from '../server/ai/interpret.js';
import { audioMimeFromFile } from '../server/ai/media.js';
import { describeConfig, loadConfig } from '../server/config.js';
import { makeDeal } from '../server/deals/store.js';
import { mapCarrier } from '../server/domain/carriers.js';
import { patchDeal } from '../server/domain/agreement.js';
import { todayUtc } from '../server/domain/dates.js';
import { addQuestions } from '../server/domain/questions.js';
import type { Deal, Role } from '../shared/types.js';

const HINDI =
  'नमस्ते जी! आपका चिकनकारी कुर्ता हाथ की कढ़ाई से बनेगा। साइज़ मीडियम, लंबाई 44 इंच, रंग हल्का हरा। कुल कीमत 120 डॉलर, 30 प्रतिशत एडवांस देना होगा। डिलीवरी 10 दिसंबर तक हो जाएगी।';
const ENGLISH = 'Does the 120 dollars include shipping to Ohio?';

const config = loadConfig();
const c = describeConfig(config);
console.log(`Gemini: backend ${config.gemini.backend}, key ${String(c.GEMINI_API_KEY)}, fast ${config.gemini.fastModel} (${config.gemini.fastTimeoutMs} ms), fallback ${config.gemini.fallbackModel}`);
if (!config.gemini.apiKey) {
  console.error('GEMINI_API_KEY is not set in .env');
  process.exit(2);
}
const deps = { callModel: sdkCallModel(createGenAI(config.gemini)), settings: config.gemini };

const deal: Deal = makeDeal({ maker: { name: 'Ravi Chikan', lang: 'hi' }, buyer: { name: 'Emily Carter', lang: 'en' } });

const audioArg = process.argv.slice(2).find((a) => a.startsWith('--audio='))?.slice('--audio='.length);

async function turn(speaker: Role, input: TurnInput): Promise<TurnResult> {
  // interpretTurn only returns output that passed the Ajv TURN_SCHEMA check; otherwise it throws.
  const r = await interpretTurn(deal, speaker, input, deps);
  const id = `m${deal.nextSeq++}`;
  deal.messages.push({ id, seq: deal.nextSeq - 1, from: speaker, kind: 'text' in input ? 'text' : 'voice', status: 'done', original: { text: r.transcript, lang: r.detectedLanguage }, translation: r.translation, createdAt: new Date().toISOString() });
  patchDeal(deal, r.patch, id, new Date(), todayUtc());
  deal.questions = addQuestions(deal.questions, r.questions, id, new Date()).questions;
  console.log(`\n--- ${speaker} turn`);
  console.log(`model ${r.ai.model}, ${r.ai.ms} ms, fallback ${r.ai.fallback}, schema-valid true`);
  console.log(`attempts: ${r.attempts.map((a) => `${a.model} ${a.outcome} ${a.ms} ms${a.detail ? ` (${a.detail.slice(0, 160)})` : ''}`).join('; ')}`);
  console.log(`detected language: ${r.detectedLanguage}`);
  if (!('text' in input)) console.log(`transcript: ${r.transcript}`);
  console.log(`translation (${r.translation.lang}): ${r.translation.text}`);
  console.log(`terms: ${JSON.stringify(r.patch)}`);
  console.log(`questions: ${JSON.stringify(r.questions)}`);
  console.log(`intent: ${JSON.stringify(r.intent)}`);
  return r;
}

type Check = (r: TurnResult) => Record<string, boolean>;

/** What each sample clip must produce (by file name); other files are checked as a full order (price and deposit). */
const CLIP_CHECKS: Record<string, Check> = {
  'shipping-answer': (r) => ({ shipping_included: r.patch.shippingIncluded === true }),
  tracking: (r) => ({
    intent_add_tracking: r.intent.kind === 'add_tracking',
    carrier_dhl: mapCarrier(r.intent.carrier) === 'DHL',
    number_4567891234: r.intent.trackingNumber === '4567891234',
  }),
  'progress-note': (r) => ({
    translated_to_en: r.translation.lang === 'en' && r.translation.text.trim().length > 0,
    mentions_kurta_or_photo: /kurta|embroider|photo|picture/i.test(r.translation.text),
  }),
};

/** One spoken maker turn from a file. The clip's required checks must pass; the other terms are reported. */
async function audioMain(file: string): Promise<void> {
  const mimeType = audioMimeFromFile(file);
  if (!mimeType) {
    console.error(`Unsupported audio extension: ${path.extname(file)}`);
    process.exit(2);
  }
  const data = readFileSync(file);
  console.log(`audio: ${path.basename(file)}, ${mimeType}, ${data.length} bytes`);
  let failed = false;
  try {
    const r = await turn('maker', { audio: { mimeType, data } });
    const p = r.patch;
    const length = p.measurements.find((m) => m.key === 'length');
    const clip = CLIP_CHECKS[path.basename(file).replace(/\.[^.]+$/, '')];
    const required = clip ? clip(r) : { price_120_usd: p.priceAmount === 120 && p.priceCurrency === 'USD', deposit_30_pct: p.depositPercent === 30 };
    const info = {
      delivery_dec_10: /^\d{4}-12-10$/.test(p.deliveryDateIso ?? ''),
      length_44_in: length?.value === 44 && length.unit === 'in',
      color_light_green: /light green/i.test(p.color?.buyer ?? ''),
    };
    console.log(`checks (required): ${JSON.stringify(required)}`);
    if (!clip) console.log(`checks (info): ${JSON.stringify(info)}`);
    if (Object.values(required).includes(false)) failed = true;
  } catch (e) {
    console.error(`audio turn failed: ${e instanceof Error ? e.message : e}`);
    if (e instanceof AiUnavailableError) for (const a of e.attempts) console.error(`  ${a.model} ${a.outcome} ${a.ms} ms ${a.detail?.slice(0, 300) ?? ''}`);
    failed = true;
  }
  console.log(failed ? '\nSMOKE FAILED' : '\nSMOKE OK');
  // exitCode instead of process.exit(): exiting while the HTTP client closes its sockets can trip a libuv assertion on Windows.
  process.exitCode = failed ? 1 : 0;
}

async function main(): Promise<void> {
  if (audioArg) return audioMain(audioArg);
  let failed = false;
  let hindi: TurnResult | null = null;
  try {
    hindi = await turn('maker', { text: HINDI });
  } catch (e) {
    console.error(`maker turn failed: ${e instanceof Error ? e.message : e}`);
    failed = true;
  }
  if (hindi) {
    const p = hindi.patch;
    const length = p.measurements.find((m) => m.key === 'length');
    const checks = {
      price_120_usd: p.priceAmount === 120 && p.priceCurrency === 'USD',
      deposit_30_pct: p.depositPercent === 30,
      delivery_dec_10: /^\d{4}-12-10$/.test(p.deliveryDateIso ?? ''),
      length_44_in: length?.value === 44 && length.unit === 'in',
      color_light_green: /light green/i.test(p.color?.buyer ?? ''),
    };
    console.log(`checks: ${JSON.stringify(checks)}`);
    if (Object.values(checks).includes(false)) failed = true;
  }
  try {
    await turn('buyer', { text: ENGLISH });
  } catch (e) {
    console.error(`buyer turn failed: ${e instanceof Error ? e.message : e}`);
    failed = true;
  }
  console.log(failed ? '\nSMOKE FAILED' : '\nSMOKE OK');
  process.exitCode = failed ? 1 : 0;
}

void main();
