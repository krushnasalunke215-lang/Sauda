/**
 * Live gating checks for new languages (decisions.md section 5), with real Gemini calls and the .env settings:
 *   (1) four text deals per language: L maker with en and hi buyers, en and hi makers with an L buyer
 *       (buyer composer.sample1, maker terms, buyer composer.sample2, maker shipping answer): every turn
 *       schema-valid, translations in the listener's script and judged faithful, all terms extracted,
 *       a shipping question with each side's text in that side's script;
 *   (2)+(3) Gemini TTS of the maker phrase (Umbriel) and of composer.sample2 (Aoede) within 20 s, each sent
 *       back as an audio turn: detected language, transcript script, 120 (and 30 for the maker) found;
 *   (7) the progress and reference photo checks give the L side in L's language.
 *   node --disable-warning=ExperimentalWarning --import tsx scripts/check-languages.ts --langs=ja,fr --out=<dir>
 * Writes <out>.md, <out>.json and the WAVs in <out>/audio (not listened to). Never prints keys.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv } from 'ajv';
import { DICTS } from '../client/src/i18n.js';
import { createGenAI, generateJson, sdkCallModel, type GenerateDeps } from '../server/ai/gemini.js';
import { interpretTurn, type TurnInput, type TurnResult } from '../server/ai/interpret.js';
import { TTS_TIMEOUT_MS, TTS_VOICES, synthesize } from '../server/ai/tts.js';
import { createVision } from '../server/ai/vision.js';
import { loadConfig, ROOT_DIR } from '../server/config.js';
import { makeDeal } from '../server/deals/store.js';
import { patchDeal } from '../server/domain/agreement.js';
import { todayUtc } from '../server/domain/dates.js';
import { addQuestions, resolveByPatch } from '../server/domain/questions.js';
import { LANGS, type Deal, type Lang, type Role } from '../shared/types.js';

/** The maker's terms and shipping answer, written by hand in every language a check deal uses. */
const PHRASES: Partial<Record<Lang, { terms: string; shipping: string }>> = {
  en: {
    terms: 'Yes, I can make the light green chikankari kurta, size medium, 44 inches long. The total price is 120 dollars, with a 30 percent deposit before I start. I will deliver it by December 10.',
    shipping: 'Yes, shipping to Ohio is included in the 120 dollars.',
  },
  hi: {
    terms: 'नमस्ते जी! आपका चिकनकारी कुर्ता हाथ की कढ़ाई से बनेगा। साइज़ मीडियम, लंबाई 44 इंच, रंग हल्का हरा। कुल कीमत 120 डॉलर, 30 प्रतिशत एडवांस देना होगा। डिलीवरी 10 दिसंबर तक हो जाएगी।',
    shipping: 'हाँ, 120 डॉलर में ओहायो तक की शिपिंग शामिल है।',
  },
  fr: {
    terms: "Oui, je peux faire la kurta chikankari vert clair, taille M, 44 pouces de long. Le prix total est de 120 dollars, avec un acompte de 30 % avant de commencer. Je la livre avant le 10 décembre.",
    shipping: "Oui, la livraison jusqu'en Ohio est comprise dans les 120 dollars.",
  },
  pt: {
    terms: 'Sim, posso fazer a kurta chikankari verde-clara, tamanho médio, com 44 polegadas de comprimento. O preço total é 120 dólares, com um sinal de 30% antes de começar. Entrego até 10 de dezembro.',
    shipping: 'Sim, o frete para Ohio está incluído nos 120 dólares.',
  },
  de: {
    terms: 'Ja, ich kann die hellgrüne Chikankari-Kurta machen, Größe M, 44 Zoll lang. Der Gesamtpreis beträgt 120 Dollar, mit 30 Prozent Anzahlung, bevor ich anfange. Ich liefere bis zum 10. Dezember.',
    shipping: 'Ja, der Versand nach Ohio ist in den 120 Dollar enthalten.',
  },
  ja: {
    terms: 'はい、薄い緑色のチカンカリのクルタをお作りできます。サイズはM、丈は44インチです。合計金額は120ドルで、作業開始前に30パーセントの前金をお願いします。12月10日までにお届けします。',
    shipping: 'はい、オハイオまでの送料は120ドルに含まれています。',
  },
};

const NAMES: Partial<Record<Lang, string>> = { en: 'Emily Carter', hi: 'Ravi Chikan', fr: 'Camille Martin', pt: 'Ana Souza', de: 'Jonas Weber', ja: '佐藤 健' };
const LANG_NAME: Partial<Record<Lang, string>> = { en: 'English', hi: 'Hindi', fr: 'French', pt: 'Brazilian Portuguese', de: 'German', ja: 'Japanese' };

const code = (c: string) => {
  const p = c.trim().split(/[-_]/)[0]!.toLowerCase();
  return p === 'cmn' ? 'zh' : p;
};

/** True when most letters are in the language's script (Japanese also needs kana, so Chinese does not pass). */
function inScript(text: string, lang: Lang): boolean {
  const letters = [...text].filter((ch) => /\p{L}/u.test(ch));
  if (!letters.length) return false;
  const re = lang === 'hi' ? /\p{Script=Devanagari}/u : lang === 'ja' ? /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u : /\p{Script=Latin}/u;
  const share = letters.filter((ch) => re.test(ch)).length / letters.length;
  if (lang === 'ja' && !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return false;
  return share >= (lang === 'ja' ? 0.6 : 0.8);
}

const config = loadConfig();
if (!config.gemini.apiKey) {
  console.error('GEMINI_API_KEY is not set in .env');
  process.exit(2);
}
const ai = createGenAI(config.gemini);
const deps: GenerateDeps = { callModel: sdkCallModel(ai), settings: config.gemini };
const judgeDeps: GenerateDeps = { callModel: deps.callModel, settings: { ...config.gemini, fastTimeoutMs: 60_000, fallbackTimeoutMs: 90_000 } };
const vision = createVision(deps);

interface Line {
  id: string;
  ok: boolean;
  detail: string;
}

/** One turn as the deal service applies it; a failed AI turn is retried once (the room's Retry button). */
async function turn(deal: Deal, speaker: Role, input: TurnInput, log: string[]): Promise<TurnResult> {
  let r: TurnResult;
  try {
    r = await interpretTurn(deal, speaker, input, deps);
  } catch (e) {
    log.push(`retry after: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    r = await interpretTurn(deal, speaker, input, deps);
  }
  const id = `m${deal.nextSeq++}`;
  const now = new Date();
  deal.messages.push({ id, seq: deal.nextSeq - 1, from: speaker, kind: 'text' in input ? 'text' : 'voice', status: 'done', original: { text: r.transcript, lang: r.detectedLanguage }, translation: r.translation, createdAt: now.toISOString() });
  const { set } = patchDeal(deal, r.patch, id, now, todayUtc(now));
  deal.questions = resolveByPatch(deal.questions, set, id).questions;
  deal.questions = addQuestions(deal.questions, r.questions, id, now).questions;
  log.push(`${speaker} ${r.ai.model}${r.ai.fallback ? ' (fallback)' : ''} ${r.ai.ms} ms, detected ${r.detectedLanguage}`);
  return r;
}

interface JudgeItem {
  id: string;
  expected_language: string;
  text: string;
  source?: string;
}

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string' }, right_language: { type: 'boolean' }, faithful: { type: 'boolean' }, reason: { type: 'string' } },
        required: ['id', 'right_language', 'faithful', 'reason'],
      },
    },
  },
  required: ['items'],
};
const validateJudge = new Ajv({ strict: false }).compile(JUDGE_SCHEMA);
const JUDGE_SYSTEM = [
  'You check the output of a live interpreter between an artisan maker and a buyer who negotiate a custom order (a kurta) in different languages.',
  'For each item: right_language = the text is written in expected_language (brand names such as Sauda or PayPal, and garment names such as kurta or chikankari, do not count against it).',
  'faithful = when a source is given, the text keeps its meaning: the item, size, colour, numbers, money, percentages, dates and the shipping answer; natural rewording is fine. Without a source, faithful = the text is a sensible, coherent statement about the photo or the order.',
  'Give a short reason in English. Return one entry per item id.',
].join('\n');

async function judge(items: JudgeItem[]): Promise<Map<string, { right_language: boolean; faithful: boolean; reason: string }>> {
  const r = await generateJson<{ items: { id: string; right_language: boolean; faithful: boolean; reason: string }[] }>(
    { label: 'language_judge', parts: [{ text: JSON.stringify(items, null, 1) }], system: JUDGE_SYSTEM, schema: JUDGE_SCHEMA, validate: validateJudge },
    judgeDeps,
  );
  return new Map(r.data.items.map((i) => [i.id, i]));
}

interface TextDeal {
  name: string;
  deal: Deal;
  log: string[];
  turns: { speaker: Role; source: string; sourceLang: Lang; result: TurnResult }[];
  error?: string;
}

async function textDeal(maker: Lang, buyer: Lang): Promise<TextDeal> {
  const deal = makeDeal({ maker: { name: NAMES[maker]!, lang: maker }, buyer: { name: NAMES[buyer]!, lang: buyer } });
  const out: TextDeal = { name: `${maker} maker × ${buyer} buyer`, deal, log: [], turns: [] };
  const steps: [Role, string][] = [
    ['buyer', DICTS[buyer]['composer.sample1']],
    ['maker', PHRASES[maker]!.terms],
    ['buyer', DICTS[buyer]['composer.sample2']],
    ['maker', PHRASES[maker]!.shipping],
  ];
  try {
    for (const [speaker, text] of steps) {
      const result = await turn(deal, speaker, { text }, out.log);
      out.turns.push({ speaker, source: text, sourceLang: deal.parties[speaker].lang, result });
    }
  } catch (e) {
    out.error = e instanceof Error ? e.message.slice(0, 300) : String(e);
  }
  return out;
}

/** The terms and the shipping question after the four turns. */
function termChecks(d: TextDeal): Line[] {
  const t = d.deal.terms;
  const { maker, buyer } = d.deal.parties;
  const q = d.deal.questions.find((x) => x.field === 'shipping');
  const id = d.name;
  return [
    { id: `${id}: price 120 USD`, ok: t.price?.value.cents === 12000 && t.price.value.currency === 'USD', detail: JSON.stringify(t.price?.value ?? null) },
    { id: `${id}: deposit 30%`, ok: t.deposit?.value.percent === 30, detail: JSON.stringify(t.deposit?.value ?? null) },
    { id: `${id}: length 44 in`, ok: t.measurements.some((m) => m.value.value === 44 && m.value.unit === 'in'), detail: JSON.stringify(t.measurements.map((m) => m.value)) },
    { id: `${id}: delivery December 10`, ok: /-12-10$/.test(t.delivery?.value.dateIso ?? ''), detail: t.delivery?.value.dateIso ?? 'none' },
    { id: `${id}: size and colour set`, ok: !!t.size && !!t.color, detail: JSON.stringify({ size: t.size?.value, color: t.color?.value }) },
    { id: `${id}: shipping included`, ok: t.shippingIncluded?.value === true, detail: String(t.shippingIncluded?.value ?? 'none') },
    {
      id: `${id}: shipping question in both scripts`,
      ok: !!q && inScript(q.text.maker, maker.lang) && inScript(q.text.buyer, buyer.lang),
      detail: q ? `${q.status}: ${JSON.stringify(q.text)}` : 'no shipping question',
    },
  ];
}

async function checkLanguage(L: Lang, audioDir: string) {
  const lines: Record<string, Line[]> = { '1 text': [], '2 voice transcription': [], '3 tts': [], '7 photo': [] };
  const logs: string[] = [];
  const judgeItems: JudgeItem[] = [];
  const judgeOwner = new Map<string, string>();

  // (1) Four text deals.
  const deals = await Promise.all([textDeal(L, 'en'), textDeal(L, 'hi'), textDeal('en', L), textDeal('hi', L)]);
  for (const d of deals) {
    logs.push(`${d.name}: ${d.log.join('; ')}`);
    lines['1 text']!.push({ id: `${d.name}: 4 turns schema-valid`, ok: !d.error && d.turns.length === 4, detail: d.error ?? 'ok' });
    for (const [i, tr] of d.turns.entries()) {
      const listener = d.deal.parties[tr.speaker === 'maker' ? 'buyer' : 'maker'].lang;
      const t = tr.result.translation;
      lines['1 text']!.push({ id: `${d.name}: turn ${i + 1} translation in ${listener} script`, ok: t.lang === listener && inScript(t.text, listener), detail: t.text });
      const jid = `${d.name} #${i + 1}`;
      judgeItems.push({ id: jid, expected_language: LANG_NAME[listener]!, text: t.text, source: `${LANG_NAME[tr.sourceLang]}: ${tr.source}` });
      judgeOwner.set(jid, '1 text');
    }
    if (!d.error) lines['1 text']!.push(...termChecks(d));
  }

  // (2)+(3) TTS of the maker phrase and the buyer's shipping question, each sent back as an audio turn.
  const spoken: { role: Role; text: string; want: RegExp[] }[] = [
    { role: 'maker', text: PHRASES[L]!.terms, want: [/120/, /30/] },
    { role: 'buyer', text: DICTS[L]['composer.sample2'], want: [/120/] },
  ];
  await Promise.all(
    spoken.map(async (s) => {
      const voice = TTS_VOICES[s.role];
      const t0 = performance.now();
      let wav: Buffer | null = null;
      try {
        wav = (await synthesize(ai, s.text, L, voice)).wav;
      } catch (e) {
        lines['3 tts']!.push({ id: `${voice} (${s.role})`, ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : String(e) });
        return;
      }
      const ms = Math.round(performance.now() - t0);
      const file = path.join(audioDir, `${L}-${s.role}-${voice.toLowerCase()}.wav`);
      writeFileSync(file, wav);
      lines['3 tts']!.push({ id: `${voice} (${s.role}) audio within 20 s`, ok: ms <= TTS_TIMEOUT_MS, detail: `${ms} ms, ${wav.length} bytes, ${file} (not listened)` });
      const other: Lang = 'en';
      const deal = makeDeal(s.role === 'maker' ? { maker: { name: NAMES[L]!, lang: L }, buyer: { name: NAMES[other]!, lang: other } } : { maker: { name: NAMES[other]!, lang: other }, buyer: { name: NAMES[L]!, lang: L } });
      const log: string[] = [];
      try {
        const r = await turn(deal, s.role, { audio: { mimeType: 'audio/wav', data: wav } }, log);
        const text = `${r.transcript} ${r.translation.text}`;
        const numbers = s.want.every((re) => re.test(text)) || (s.role === 'maker' && r.patch.priceAmount === 120 && r.patch.depositPercent === 30);
        const ok = code(r.detectedLanguage) === L && inScript(r.transcript, L) && numbers;
        const line = { id: `${voice} (${s.role}) round trip: language ${L}, script, ${s.want.map(String).join(' ')}`, ok, detail: `detected ${r.detectedLanguage}; transcript: ${r.transcript}` };
        lines['2 voice transcription']!.push(line);
        lines['3 tts']!.push({ ...line, id: `${voice} (${s.role}) transcribes back with the key numbers` });
      } catch (e) {
        const line = { id: `${voice} (${s.role}) audio turn`, ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : String(e) };
        lines['2 voice transcription']!.push(line);
        lines['3 tts']!.push(line);
      }
      logs.push(`audio ${s.role}: ${log.join('; ')}`);
    }),
  );

  // (7) Photo checks on the deals with the full terms: progress (L maker) and reference (L buyer).
  const makerDeal = deals[0]!.deal;
  const buyerDeal = deals[2]!.deal;
  const jpeg = (f: string) => ({ mimeType: 'image/jpeg' as const, data: readFileSync(path.join(ROOT_DIR, 'samples', f)) });
  // A failed photo call is retried once, as the room's Retry button does.
  const once = <T>(f: () => Promise<T>) => f().catch(() => f());
  const [progress, reference] = await Promise.allSettled([
    once(() => vision.checkProgress(makerDeal, jpeg('progress.jpg'))),
    once(() => vision.describeReference(buyerDeal, jpeg('reference.jpg'))),
  ]);
  if (progress.status === 'fulfilled') {
    const texts = [progress.value.summary.maker, ...progress.value.checks.map((c) => c.note.maker)].filter(Boolean);
    lines['7 photo']!.push({ id: 'progress photo: maker side in L script', ok: texts.length > 0 && texts.every((x) => inScript(x, L)), detail: texts.join(' | ') });
    judgeItems.push({ id: 'progress photo (maker)', expected_language: LANG_NAME[L]!, text: texts.join('\n') });
    judgeOwner.set('progress photo (maker)', '7 photo');
  } else lines['7 photo']!.push({ id: 'progress photo', ok: false, detail: String(progress.reason).slice(0, 200) });
  if (reference.status === 'fulfilled') {
    const texts = [reference.value.description.buyer, ...reference.value.details.map((d) => d.value.buyer)].filter(Boolean);
    lines['7 photo']!.push({ id: 'reference photo: buyer side in L script', ok: texts.length > 0 && texts.every((x) => inScript(x, L)), detail: texts.join(' | ') });
    judgeItems.push({ id: 'reference photo (buyer)', expected_language: LANG_NAME[L]!, text: texts.join('\n') });
    judgeOwner.set('reference photo (buyer)', '7 photo');
  } else lines['7 photo']!.push({ id: 'reference photo', ok: false, detail: String(reference.reason).slice(0, 200) });

  // One judge call for every translation and photo text of this language.
  try {
    const verdicts = await judge(judgeItems);
    for (const item of judgeItems) {
      const v = verdicts.get(item.id);
      lines[judgeOwner.get(item.id)!]!.push({ id: `judge: ${item.id}`, ok: !!v && v.right_language && v.faithful, detail: v ? `${v.right_language ? 'right language' : 'WRONG LANGUAGE'}, ${v.faithful ? 'faithful' : 'NOT FAITHFUL'}: ${v.reason}` : 'no verdict' });
    }
  } catch (e) {
    lines['1 text']!.push({ id: 'judge call', ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : String(e) });
  }
  const pass = Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, v.length > 0 && v.every((l) => l.ok)]));
  return { lang: L, pass, ok: Object.values(pass).every(Boolean), lines, logs };
}

function arg(name: string): string | undefined {
  return process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main(): Promise<void> {
  const out = arg('out');
  if (!out) {
    console.error('usage: check-languages.ts --out=<dir> [--langs=ja,fr]');
    process.exitCode = 2;
    return;
  }
  const langs = (arg('langs')?.split(',') ?? LANGS.filter((l) => l !== 'hi' && l !== 'en' && l !== 'es')).map((s) => s.trim()) as Lang[];
  for (const l of langs) if (!LANGS.includes(l) || !PHRASES[l]) throw new Error(`no phrases or no LANGS entry for ${l}`);
  const audioDir = path.join(out, 'audio');
  mkdirSync(audioDir, { recursive: true });
  console.log(`checking ${langs.join(', ')} (Gemini ${config.gemini.backend}, ${config.gemini.fastModel} / ${config.gemini.fallbackModel})`);
  // One language at a time: four in parallel ran into Vertex rate limits (both models erroring).
  const results: Awaited<ReturnType<typeof checkLanguage>>[] = [];
  for (const l of langs) results.push(await checkLanguage(l, audioDir));
  for (const r of results) console.log(`${r.lang}: ${r.ok ? 'PASS' : 'FAIL'} ${JSON.stringify(r.pass)}`);

  const md = [
    '# Language checks (scripts/check-languages.ts)',
    '',
    `${new Date().toISOString()}, Gemini ${config.gemini.fastModel} with ${config.gemini.fallbackModel} as the fallback; TTS voices ${TTS_VOICES.maker} (maker) and ${TTS_VOICES.buyer} (buyer). The WAVs in ${audioDir} have not been listened to.`,
    '',
    '| Language | 1 text | 2 voice transcription | 3 TTS | 7 photo | Result |',
    '|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.lang} | ${['1 text', '2 voice transcription', '3 tts', '7 photo'].map((k) => (r.pass[k] ? 'PASS' : 'FAIL')).join(' | ')} | ${r.ok ? 'PASS' : 'FAIL'} |`),
    '',
    ...results.flatMap((r) => [
      `## ${r.lang}: ${r.ok ? 'PASS' : 'FAIL'}`,
      '',
      ...Object.entries(r.lines).flatMap(([k, ls]) => [`### ${k}`, '', ...ls.map((l) => `- ${l.ok ? 'PASS' : '**FAIL**'} ${l.id}: ${l.detail.replace(/\n/g, ' ')}`), '']),
      '### Model calls',
      '',
      ...r.logs.map((l) => `- ${l}`),
      '',
    ]),
  ];
  writeFileSync(`${out}.md`, md.join('\n'), 'utf8');
  writeFileSync(`${out}.json`, `${JSON.stringify(results.map(({ lang, pass, ok, lines }) => ({ lang, ok, pass, lines })), null, 1)}\n`, 'utf8');
  console.log(`wrote ${out}.md and ${out}.json`);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
