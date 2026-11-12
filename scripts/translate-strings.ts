/**
 * Drafts the UI, sample-label and invoice strings of new languages with Gemini (Vertex express, .env).
 * Each chunk of about 80 keys is translated, back-translated to English, and checked by a third call that
 * lists only problem keys with a fix; fixes that keep the placeholders are applied and logged in the review.
 *   node --disable-warning=ExperimentalWarning --import tsx scripts/translate-strings.ts --langs=fr,ja --out=<dir> [--write] [--keys=a,b]
 * Outputs <out>/<code>.json (UI + sample labels), <code>.back.json, <code>.review.md, <code>.server.json.
 * --write also writes client/src/locales/<code>.ts and the labels in samples/manifest.json.
 * --keys re-translates only those keys into the existing outputs. Never prints keys or secrets.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv } from 'ajv';
import { DICTS } from '../client/src/i18n.js';
import { AiUnavailableError, createGenAI, generateJson, sdkCallModel, type GenerateDeps } from '../server/ai/gemini.js';
import { loadConfig, ROOT_DIR } from '../server/config.js';
import { LANG_ENDONYMS, type Lang } from '../shared/types.js';

const CHUNK = 80;
const PARALLEL = 3;
const RETRIES = 2;

/** Target languages: the English name and the register the UI uses. */
const TARGETS: Record<string, { name: string; register: string }> = {
  fr: { name: 'French (France)', register: 'Address the user formally with "vous". Use French typography (a space before : ? ! is fine but optional; keep it consistent).' },
  pt: { name: 'Brazilian Portuguese (pt-BR)', register: 'Brazilian Portuguese, never European Portuguese. Address the user with "você".' },
  de: { name: 'German', register: 'Address the user formally with "Sie". Prefer short words in tab and button labels; avoid long compounds where a shorter word exists.' },
  ja: { name: 'Japanese', register: 'Polite です/ます style in sentences; short noun phrases for labels, tabs and buttons. Use natural kanji and kana, no romaji.' },
  zh: { name: 'Simplified Chinese (zh-CN, Mandarin)', register: 'Simplified characters only, mainland usage.' },
  ru: { name: 'Russian', register: 'Address the user formally with "вы".' },
  id: { name: 'Indonesian', register: 'Address the user with "Anda".' },
  ko: { name: 'Korean', register: 'Polite 합니다/해요 style; short labels.' },
  it: { name: 'Italian', register: 'Address the user with "tu" as in modern apps, consistently.' },
  tr: { name: 'Turkish', register: 'Address the user with "siz".' },
  vi: { name: 'Vietnamese', register: 'Polite, neutral app style.' },
};

const SYSTEM = (lang: string) =>
  [
    `You translate the user interface strings of Sauda from English into ${TARGETS[lang]!.name}.`,
    'Sauda is a web deal room where a maker (an artisan who makes a custom order, for example an embroidered kurta) and a buyer who speak different languages negotiate the order; Gemini interprets every message, and PayPal sends the invoice and takes the payments.',
    'Glossary: "Sauda" and "PayPal" are brand names and are never translated or transliterated. "Maker" = the artisan who makes the order. "Buyer" = the customer. "Deposit" = the advance paid before work starts. "Balance" = the rest of the price, paid after the buyer approves the progress photo. "Invoice" = the PayPal invoice. "Judge mode" = a mode for hackathon judges that shows technical details. Keep words like kurta, chikankari, saree and dupatta as the garment names.',
    TARGETS[lang]!.register,
    'Rules: keep every placeholder in curly braces, such as {name}, {amount} or {lang}, exactly as written and untranslated. Keep symbols, numbers, $ amounts, "·", "→", "…", emoji, SHA-256, #, URLs and codes like INV2 as they are.',
    'Keep tab, step, chip and button labels about as short as the English. Sentences should read naturally, not word for word.',
    'Keys named langName.<code> are language names as used inside a sentence (e.g. "Write to {name} in {lang}"); use the normal capitalisation of the target language for language names.',
    'The key names give context (for example tab.*, button-like *.send or *.approve, event.* chat event chips, error.* messages). Return one translation per key, using the same keys.',
  ].join('\n');

const BACK_SYSTEM = (lang: string) =>
  `You translate app interface strings from ${TARGETS[lang]!.name} back into English, literally enough that a reviewer can compare them with the original English. Keep placeholders in curly braces exactly. Return one English string per key, using the same keys.`;

const JUDGE_SYSTEM = (lang: string) =>
  [
    `You review ${TARGETS[lang]!.name} translations of a web app's interface strings (a deal room between an artisan maker and a buyer; PayPal handles the invoice and payments).`,
    'For each key you get the English source, the translation and a back-translation into English. List ONLY the keys whose translation is wrong, misleading, unnatural, in the wrong register, much longer than needed for a label, or that changes or drops a placeholder in curly braces.',
    TARGETS[lang]!.register,
    '"Sauda" and "PayPal" must stay untranslated. For each problem give a short reason in English and a corrected translation that keeps the placeholders exactly. Return an empty list when everything is fine.',
  ].join('\n');

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    problems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { key: { type: 'string' }, reason: { type: 'string' }, fix: { type: 'string' } },
        required: ['key', 'reason', 'fix'],
      },
    },
  },
  required: ['problems'],
};

const ajv = new Ajv({ strict: false, allErrors: true });
const validateJudge = ajv.compile(JUDGE_SCHEMA);

function stringsSchema(keys: string[]): object {
  return { type: 'object', additionalProperties: false, properties: Object.fromEntries(keys.map((k) => [k, { type: 'string' }])), required: keys };
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

/** Keys whose value is missing, empty, or has different placeholders from the source. */
function badKeys(source: Record<string, string>, out: Record<string, unknown>): string[] {
  return Object.keys(source).filter((k) => typeof out[k] !== 'string' || !(out[k] as string).trim() || placeholders(out[k] as string) !== placeholders(source[k]!));
}

// ---- sources ----

const en = DICTS.en as Record<string, string>;
const COPIED = (k: string) => k === 'app.name' || k.startsWith('carrier.');
const COMPUTED = (k: string) => k.startsWith('lang.');

interface ManifestEntry {
  id: string;
  label: Record<string, string>;
  [k: string]: unknown;
}
const MANIFEST_FILE = path.join(ROOT_DIR, 'samples', 'manifest.json');
const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')) as ManifestEntry[];

/** The invoice texts (server/domain/agreement-text.ts LABELS), the unit word, the board sample items and the byte-test fixture. */
const SERVER_SOURCE: Record<string, string> = {
  'labels.title': 'Sauda order agreement',
  'labels.maker': 'Maker',
  'labels.buyer': 'Buyer',
  'labels.item': 'Item',
  'labels.quantity': 'Quantity',
  'labels.size': 'Size',
  'labels.measurements': 'Measurements',
  'labels.color': 'Colour',
  'labels.price': 'Total price',
  'labels.deposit': 'Deposit',
  'labels.balance': 'Balance',
  'labels.delivery': 'Delivery by',
  'labels.shipping': 'Shipping',
  'labels.shippingYes': 'included in the price',
  'labels.shippingNo': 'not included in the price',
  'labels.depositWhen': 'before work starts',
  'labels.balanceWhen': 'after the buyer approves the progress photo',
  'labels.confirmed': 'Both sides confirmed in their own language on {date}',
  'labels.termsTitle': 'Terms',
  'labels.termDeposit': 'Work starts after the deposit of {amount} is paid on this invoice.',
  'labels.termBalance': 'The balance is due after the buyer approves the progress photo.',
  'labels.termMadeToOrder': 'Made to order: no returns once cutting starts, unless the item does not match this agreement.',
  'unit.in': 'in (the abbreviation of inches, as in "44 in")',
  'sampleItem.1': 'Block-print cotton saree',
  'sampleItem.2': 'Embroidered silk dupatta',
  'fixture.item': 'Hand-embroidered chikankari kurta with mirror work, scalloped hem and a matching cotton lining',
  'fixture.size': 'Medium, custom fitted',
  'fixture.color': 'Light pista green with ivory thread',
  'fixture.m.length': 'Length',
  'fixture.m.chest': 'Chest',
  'fixture.m.waist': 'Waist',
  'fixture.m.shoulder': 'Shoulder width',
  'fixture.m.sleeve': 'Sleeve length',
  'fixture.m.hip': 'Hip',
};

/** Everything sent to the model, as one flat map (UI keys as they are, sample labels as sample:<id>, server keys as server:<key>). */
function sources(): Record<string, string> {
  const s: Record<string, string> = {};
  for (const [k, v] of Object.entries(en)) if (!COPIED(k) && !COMPUTED(k)) s[k] = v;
  for (const e of manifest) s[`sample:${e.id}`] = e.label.en!;
  for (const [k, v] of Object.entries(SERVER_SOURCE)) s[`server:${k}`] = v;
  return s;
}

// ---- model calls ----

const config = loadConfig();
if (!config.gemini.apiKey) {
  console.error('GEMINI_API_KEY is not set in .env');
  process.exit(2);
}
// Long chunks: give Flash 90 s before the fallback is asked too (the app's 8 s is for chat turns).
const deps: GenerateDeps = {
  callModel: sdkCallModel(createGenAI(config.gemini)),
  settings: { fastModel: config.gemini.fastModel, fallbackModel: config.gemini.fallbackModel, fastTimeoutMs: 90_000, fallbackTimeoutMs: 120_000 },
};

async function callStrings(label: string, system: string, keys: string[], payload: object): Promise<Record<string, string>> {
  const schema = stringsSchema(keys);
  const r = await generateJson<Record<string, string>>({ label, parts: [{ text: JSON.stringify(payload, null, 1) }], system, schema, validate: ajv.compile(schema) }, deps);
  console.log(`  ${label}: ${r.model} ${r.ms} ms${r.fallback ? ' (fallback)' : ''}`);
  return r.data;
}

async function translateChunk(lang: string, src: Record<string, string>, label: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let todo = Object.keys(src);
  for (let attempt = 0; attempt <= RETRIES && todo.length; attempt++) {
    const part = Object.fromEntries(todo.map((k) => [k, src[k]!]));
    try {
      const got = await callStrings(`${label} translate${attempt ? ` retry ${attempt}` : ''}`, SYSTEM(lang), todo, { translate_from_english: part });
      const bad = badKeys(part, got);
      for (const k of todo) if (!bad.includes(k)) out[k] = got[k]!.trim();
      todo = bad;
    } catch (e) {
      console.error(`  ${label}: ${e instanceof AiUnavailableError ? e.message : e instanceof Error ? e.message.slice(0, 200) : e}`);
    }
  }
  if (todo.length) throw new Error(`${label}: no valid translation for ${todo.join(', ')}`);
  return out;
}

interface ChunkResult {
  tr: Record<string, string>;
  back: Record<string, string>;
  problems: { key: string; reason: string; fix: string; applied: boolean; before: string }[];
}

async function runChunk(lang: string, src: Record<string, string>, label: string): Promise<ChunkResult> {
  const tr = await translateChunk(lang, src, label);
  const keys = Object.keys(src);
  const back = await callStrings(`${label} back`, BACK_SYSTEM(lang), keys, { translate_to_english: tr });
  const items = Object.fromEntries(keys.map((k) => [k, { english: src[k], translation: tr[k], back_translation: back[k] }]));
  const j = await generateJson<{ problems: { key: string; reason: string; fix: string }[] }>(
    { label: `${label} judge`, parts: [{ text: JSON.stringify(items, null, 1) }], system: JUDGE_SYSTEM(lang), schema: JUDGE_SCHEMA, validate: validateJudge },
    deps,
  );
  console.log(`  ${label} judge: ${j.model} ${j.ms} ms, ${j.data.problems.length} problem(s)`);
  const problems: ChunkResult['problems'] = [];
  for (const p of j.data.problems) {
    if (!(p.key in src)) continue;
    const before = tr[p.key]!;
    const ok = !!p.fix.trim() && placeholders(p.fix) === placeholders(src[p.key]!);
    if (ok) tr[p.key] = p.fix.trim();
    problems.push({ ...p, applied: ok, before });
  }
  return { tr, back, problems };
}

/** Runs tasks with at most `n` at a time. */
async function pool<T>(tasks: (() => Promise<T>)[], n: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await tasks[i]!();
      }
    }),
  );
  return results;
}

// ---- outputs ----

const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

function readJson(file: string): Record<string, string> {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>) : {};
}

/** The full UI dictionary: copied brand keys, computed lang.* keys, and the translations in English key order. */
function uiDict(lang: string, tr: Record<string, string>): Record<string, string> {
  const d: Record<string, string> = {};
  for (const k of Object.keys(en)) {
    if (COPIED(k)) d[k] = en[k]!;
    else if (COMPUTED(k)) {
      const code = k.slice('lang.'.length) as Lang;
      const endonym = LANG_ENDONYMS[code] ?? en[k]!;
      const name = tr[`langName.${code}`];
      d[k] = code === lang || !name ? endonym : `${endonym} (${name})`;
    } else d[k] = tr[k] ?? '';
  }
  return d;
}

function writeLocale(lang: string, dict: Record<string, string>): void {
  const lines = [
    '/**',
    ` * ${TARGETS[lang]!.name} UI strings, generated by scripts/translate-strings.ts. Gemini drafted them; each was`,
    ' * back-translated to English and checked by a judge call. No native speaker has reviewed them.',
    ` * Re-translate changed keys with: scripts/translate-strings.ts --langs=${lang} --keys=<keys> --write`,
    ' */',
    "import type { Dict } from '../i18n.js';",
    '',
    `export const ${lang}: Dict = {`,
    ...Object.entries(dict).map(([k, v]) => `  ${q(k)}: ${q(v)},`),
    '};',
    '',
  ];
  const dir = path.join(ROOT_DIR, 'client', 'src', 'locales');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${lang}.ts`), lines.join('\n'), 'utf8');
}

function writeManifest(labels: Record<string, Record<string, string>>): void {
  for (const e of manifest) for (const [lang, byId] of Object.entries(labels)) if (byId[e.id]) e.label[lang] = byId[e.id]!;
  writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

// ---- main ----

function arg(name: string): string | undefined {
  return process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main(): Promise<void> {
  const langs = (arg('langs') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const out = arg('out');
  const write = process.argv.includes('--write');
  const onlyKeys = arg('keys')?.split(',').map((s) => s.trim()).filter(Boolean);
  if (!langs.length || !out) {
    console.error('usage: translate-strings.ts --langs=fr,ja --out=<dir> [--write] [--keys=a,b]');
    process.exitCode = 2;
    return;
  }
  for (const l of langs) if (!TARGETS[l] || l === 'en') throw new Error(`unknown target language ${l}`);
  mkdirSync(out, { recursive: true });
  const all = sources();
  // Sample labels are keyed sample:<id>, server strings server:<key> (e.g. --keys=server:labels.title).
  const src = onlyKeys ? Object.fromEntries(Object.entries(all).filter(([k]) => onlyKeys.includes(k))) : all;
  const keys = Object.keys(src);
  if (onlyKeys && !keys.length && !onlyKeys.every((k) => COMPUTED(k))) throw new Error('none of --keys is a translatable key');
  console.log(`${langs.join(', ')}: ${keys.length} strings, ${Math.ceil(keys.length / CHUNK)} chunk(s) per language`);

  const jobs: { lang: string; i: number; src: Record<string, string> }[] = [];
  for (const lang of langs) for (let i = 0; i < keys.length; i += CHUNK) jobs.push({ lang, i: i / CHUNK, src: Object.fromEntries(keys.slice(i, i + CHUNK).map((k) => [k, src[k]!])) });
  let failed = false;
  const results = await pool(
    jobs.map((j) => async () => {
      try {
        return await runChunk(j.lang, j.src, `${j.lang} #${j.i + 1}`);
      } catch (e) {
        failed = true;
        console.error(`${j.lang} #${j.i + 1} failed: ${e instanceof Error ? e.message.slice(0, 300) : e}`);
        return null;
      }
    }),
    PARALLEL * langs.length,
  );
  if (failed) {
    console.error('\nTRANSLATION FAILED (outputs not written)');
    process.exitCode = 1;
    return;
  }

  const manifestLabels: Record<string, Record<string, string>> = {};
  for (const lang of langs) {
    const mine = results.filter((_, i) => jobs[i]!.lang === lang) as ChunkResult[];
    const file = (ext: string) => path.join(out, `${lang}${ext}`);
    // Merge into the existing outputs when only some keys were re-translated.
    const ui = onlyKeys ? readJson(file('.json')) : {};
    const back = onlyKeys ? readJson(file('.back.json')) : {};
    const server = onlyKeys ? readJson(file('.server.json')) : {};
    const problems = mine.flatMap((r) => r.problems);
    for (const r of mine) {
      for (const [k, v] of Object.entries(r.tr)) (k.startsWith('server:') ? server : ui)[k.replace(/^server:/, '')] = v;
      for (const [k, v] of Object.entries(r.back)) back[k] = v;
    }
    writeFileSync(file('.json'), `${JSON.stringify(ui, null, 1)}\n`, 'utf8');
    writeFileSync(file('.back.json'), `${JSON.stringify(back, null, 1)}\n`, 'utf8');
    writeFileSync(file('.server.json'), `${JSON.stringify(server, null, 1)}\n`, 'utf8');
    const review = [
      `# ${TARGETS[lang]!.name} (${lang}) translation review`,
      '',
      `${new Date().toISOString()}: ${keys.length} strings${onlyKeys ? ` (--keys ${onlyKeys.join(',')})` : ''}; the judge flagged ${problems.length}, ${problems.filter((p) => p.applied).length} fixes applied.`,
      '',
      ...problems.map((p) => `- \`${p.key}\` ${p.applied ? '(fixed)' : '(NOT fixed: the fix changed the placeholders)'}: ${p.reason}\n  - before: ${p.before}\n  - after: ${p.applied ? p.fix : p.before}`),
      '',
    ];
    const reviewFile = file('.review.md');
    writeFileSync(reviewFile, onlyKeys && existsSync(reviewFile) ? `${readFileSync(reviewFile, 'utf8')}\n${review.join('\n')}` : review.join('\n'), 'utf8');
    console.log(`${lang}: wrote ${path.basename(file('.json'))}, .back.json, .server.json, .review.md (${problems.length} judged problems)`);
    if (write) {
      const dict = uiDict(lang, ui);
      const missing = Object.keys(en).filter((k) => !dict[k]);
      if (missing.length) throw new Error(`${lang}: no translation for ${missing.join(', ')}`);
      writeLocale(lang, dict);
      manifestLabels[lang] = Object.fromEntries(Object.entries(ui).filter(([k]) => k.startsWith('sample:')).map(([k, v]) => [k.slice('sample:'.length), v]));
      console.log(`${lang}: wrote client/src/locales/${lang}.ts`);
    }
  }
  if (write) {
    writeManifest(manifestLabels);
    console.log('wrote samples/manifest.json labels');
  }
  console.log('\nTRANSLATION OK');
  process.exitCode = 0;
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
