/**
 * Installs Bryntum Gantt (Community tier, MIT, public npm registry) for the production board.
 * It is never added to package.json or package-lock.json (`--no-save`), so `npm ci && npm run build`
 * always works and gives the fallback board; vite.config.ts switches to the Bryntum board when the
 * package is in node_modules. Render runs this in its build step.
 *   npm run bryntum:install          install (skips when the right version is already there)
 *   SAUDA_BRYNTUM=off                skip it and build the fallback board
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BRYNTUM_PACKAGE = '@bryntum/gantt-community';
export const BRYNTUM_VERSION = '8.0.0';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = `${BRYNTUM_PACKAGE}@${BRYNTUM_VERSION}`;

if ((process.env.SAUDA_BRYNTUM ?? '').toLowerCase() === 'off') {
  console.log('Bryntum skipped: fallback board');
  process.exit(0);
}

const installed = path.join(ROOT, 'node_modules', ...BRYNTUM_PACKAGE.split('/'), 'package.json');
if (existsSync(installed) && JSON.parse(readFileSync(installed, 'utf8')).version === BRYNTUM_VERSION) {
  console.log(`Bryntum ${spec} already installed`);
  process.exit(0);
}

console.log(`Installing ${spec} (not saved to package.json)`);
const args = ['install', '--no-save', '--no-audit', '--no-fund', spec];
// Under `npm run`, npm_execpath is npm's own CLI script: run it with this node, no shell needed.
const npmCli = process.env.npm_execpath;
const res = npmCli
  ? spawnSync(process.execPath, [npmCli, ...args], { cwd: ROOT, stdio: 'inherit' })
  : spawnSync(process.platform === 'win32' ? `npm ${args.join(' ')}` : 'npm', process.platform === 'win32' ? [] : args, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
if (res.status !== 0) {
  console.error(`Bryntum install failed (exit ${res.status ?? res.signal}); the build falls back to the fallback board.`);
  // Not fatal: Sauda works without Bryntum.
  process.exit(0);
}
console.log(`Bryntum ${spec} installed`);
