/**
 * Live smoke test of the turn interpreter: real Gemini calls with the settings from .env.
 *   npm run smoke:gemini
 * Prints only the model, timing, fallback, schema validity, translation and extracted terms (never keys).
 */
import { createGenAI, sdkCallModel } from '../server/ai/gemini.js';
import { interpretTurn, type TurnResult } from '../server/ai/interpret.js';
import { describeConfig, loadConfig } from '../server/config.js';
import { makeDeal } from '../server/deals/store.js';
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

const deal: Deal = makeDeal({ maker: { name: 'Asha Chikan Studio', lang: 'hi' }, buyer: { name: 'Emily Carter', lang: 'en' } });

async function turn(speaker: Role, text: string): Promise<TurnResult> {
  // interpretTurn only returns output that passed the Ajv TURN_SCHEMA check; otherwise it throws.
  const r = await interpretTurn(deal, speaker, { text }, deps);
  const id = `m${deal.nextSeq++}`;
  deal.messages.push({ id, seq: deal.nextSeq - 1, from: speaker, kind: 'text', status: 'done', original: { text, lang: r.detectedLanguage }, translation: r.translation, createdAt: new Date().toISOString() });
  patchDeal(deal, r.patch, id, new Date(), todayUtc());
  deal.questions = addQuestions(deal.questions, r.questions, id, new Date()).questions;
  console.log(`\n--- ${speaker} turn`);
  console.log(`model ${r.ai.model}, ${r.ai.ms} ms, fallback ${r.ai.fallback}, schema-valid true`);
  console.log(`attempts: ${r.attempts.map((a) => `${a.model} ${a.outcome} ${a.ms} ms`).join('; ')}`);
  console.log(`detected language: ${r.detectedLanguage}`);
  console.log(`translation (${r.translation.lang}): ${r.translation.text}`);
  console.log(`terms: ${JSON.stringify(r.patch)}`);
  console.log(`questions: ${JSON.stringify(r.questions)}`);
  console.log(`intent: ${JSON.stringify(r.intent)}`);
  return r;
}

async function main(): Promise<void> {
  let failed = false;
  let hindi: TurnResult | null = null;
  try {
    hindi = await turn('maker', HINDI);
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
    await turn('buyer', ENGLISH);
  } catch (e) {
    console.error(`buyer turn failed: ${e instanceof Error ? e.message : e}`);
    failed = true;
  }
  console.log(failed ? '\nSMOKE FAILED' : '\nSMOKE OK');
  process.exit(failed ? 1 : 0);
}

void main();
