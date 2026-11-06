/**
 * Looks for the credential values from .env in everything that could become public: tracked and
 * untracked (not ignored) files, the full git history and the built client in dist/.
 * Prints hit counts per variable NAME and the paths, never the values. Exits 1 on any hit.
 *   npm run secret-scan
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAMES = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MERCHANT_EMAIL', 'PAYPAL_BUYER_EMAIL', 'GEMINI_API_KEY', 'BRYNTUM_NPM_TOKEN'];
const MIN_LENGTH = 8;

const envFile = path.join(ROOT, '.env');
if (!existsSync(envFile)) {
  console.error('secret-scan: no .env file, so there are no values to look for.');
  process.exit(2);
}
const env = parseEnv(readFileSync(envFile, 'utf8'));
const secrets = NAMES.map((name) => ({ name, value: Buffer.from((env[name] ?? '').trim()) })).filter((s) => s.value.length >= MIN_LENGTH);

const git = (args) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 1024 * 1024 * 1024 });
const list = (args) => git(args).toString('utf8').split('\0').filter(Boolean);

/** @type {Map<string, Set<string>>} */
const hits = new Map(secrets.map((s) => [s.name, new Set()]));
let scanned = 0;

function scan(label, buf) {
  scanned++;
  for (const s of secrets) if (buf.indexOf(s.value) !== -1) hits.get(s.name).add(label);
}

const files = new Set([...list(['ls-files', '-z']), ...list(['ls-files', '-z', '--others', '--exclude-standard'])]);
for (const f of files) {
  const abs = path.join(ROOT, f);
  if (existsSync(abs) && statSync(abs).isFile()) scan(f, readFileSync(abs));
}

let hasCommits = true;
try {
  git(['rev-parse', '--verify', 'HEAD']);
} catch {
  hasCommits = false;
}
if (hasCommits) scan('git log -p --all', git(['log', '-p', '--all', '--no-color']));

function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs);
    else if (e.isFile()) scan(path.relative(ROOT, abs).replaceAll('\\', '/'), readFileSync(abs));
  }
}
const dist = path.join(ROOT, 'dist');
if (existsSync(dist)) walk(dist);

let total = 0;
console.log(`secret-scan: ${secrets.length} values (${secrets.map((s) => s.name).join(', ')}) across ${scanned} sources`);
for (const [name, where] of hits) {
  total += where.size;
  console.log(`  ${name}: ${where.size} hit(s)${where.size ? ` in ${[...where].join(', ')}` : ''}`);
}
console.log(total === 0 ? 'secret-scan: 0 hits' : `secret-scan: ${total} hit(s) — remove them before committing or pushing`);
process.exit(total === 0 ? 0 : 1);
