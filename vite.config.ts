import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const server = 'http://localhost:8787';
const ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * Picks the production board at build time: 'virtual:sauda-board' resolves to BryntumBoard.tsx when
 * the Bryntum package is installed (npm run bryntum:install, never in package.json) and to
 * FallbackBoard.tsx otherwise. dist/client/build-info.json records the choice for /healthz.
 */
function saudaBoard(): Plugin {
  const pkg = path.join(ROOT, 'node_modules', '@bryntum', 'gantt');
  const kind = existsSync(path.join(pkg, 'package.json')) && existsSync(path.join(pkg, 'gantt.css')) ? 'bryntum' : 'fallback';
  const file = path.join(ROOT, 'client', 'src', 'board', kind === 'bryntum' ? 'BryntumBoard.tsx' : 'FallbackBoard.tsx');
  return {
    name: 'sauda-board',
    configResolved(config) {
      config.logger.info(`sauda: production board = ${kind}`);
    },
    resolveId(id) {
      return id === 'virtual:sauda-board' ? file : null;
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build-info.json', source: `${JSON.stringify({ board: kind })}\n` });
    },
  };
}

export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss(), saudaBoard()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': server,
      '/healthz': server,
      '/socket.io': { target: server, ws: true },
    },
  },
});
