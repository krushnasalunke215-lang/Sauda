import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { LANGS, ROLES, type SampleInfo } from '../../shared/types.js';
import { audioMimeFromFile, MEDIA_FILE_RE, serveType, type AudioMime } from '../ai/media.js';
import { ServiceError } from '../deals/service.js';
import { short } from './deals.js';

interface SampleEntry extends SampleInfo {
  file: string;
}

/**
 * The built-in samples (the user's own Hindi clips) listed in samples/manifest.json. A sample turn
 * goes through the same audio pipeline as an upload.
 */
export class SampleLibrary {
  private readonly entries: SampleEntry[];

  constructor(private readonly dir: string) {
    let raw: unknown = [];
    try {
      raw = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    } catch {
      raw = [];
    }
    this.entries = (Array.isArray(raw) ? raw : []).filter(
      (e): e is SampleEntry =>
        typeof e?.id === 'string' &&
        typeof e.file === 'string' &&
        MEDIA_FILE_RE.test(e.file) &&
        ROLES.includes(e.role) &&
        LANGS.includes(e.lang) &&
        (e.kind === 'voice' || e.kind === 'photo'),
    );
  }

  list(): SampleInfo[] {
    return this.entries.map(({ id, role, lang, label, kind }) => ({ id, role, lang, label, kind }));
  }

  get(id: string): SampleEntry | null {
    return this.entries.find((e) => e.id === id) ?? null;
  }

  readFile(entry: SampleEntry): Promise<Buffer> {
    return readFile(path.join(this.dir, entry.file));
  }

  async readAudio(entry: SampleEntry): Promise<{ mimeType: AudioMime; data: Buffer }> {
    const mimeType = audioMimeFromFile(entry.file);
    if (!mimeType) throw new Error(`sample ${entry.id} is not audio`);
    return { mimeType, data: await readFile(path.join(this.dir, entry.file)) };
  }
}

export function sampleRoutes(app: FastifyInstance, samples: SampleLibrary): void {
  app.get('/api/samples', async () => samples.list());

  /** The sample file itself, so the sample-photo buttons can upload it through the normal photo endpoint. */
  app.get<{ Params: { sid: string } }>(
    '/api/samples/:sid/file',
    { schema: { params: { type: 'object', required: ['sid'], properties: { sid: short } } } },
    async (req, reply) => {
      const s = samples.get(req.params.sid);
      if (!s) throw new ServiceError(404, 'sample_not_found');
      return reply
        .header('Content-Type', serveType(s.file))
        .header('Cache-Control', 'public, max-age=3600')
        .send(await samples.readFile(s));
    },
  );
}
