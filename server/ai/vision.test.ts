import { describe, expect, it } from 'vitest';
import { spikeDeal } from '../domain/test-fixtures.js';
import type { CallModel, ModelRequest } from './gemini.js';
import { validateProgress, validateReference } from './schemas.js';
import { createVision, normalizeProgress, normalizeReference } from './vision.js';

const settings = { fastModel: 'fast', fallbackModel: 'slow', fastTimeoutMs: 200, fallbackTimeoutMs: 500 };
const IMAGE = { mimeType: 'image/jpeg' as const, data: Buffer.from('fake-jpeg') };

const REFERENCE = {
  description: { maker: '  हल्के हरे रंग का चिकनकारी कुर्ता  ', buyer: 'A light green chikankari kurta' },
  details: [
    { aspect: 'Neckline', value: { maker: 'गला: गोल', buyer: '' } },
    { aspect: 'embroidery', value: { maker: '', buyer: '' } },
  ],
};

const PROGRESS = {
  checks: [
    { field: 'color', status: 'matches', note: { maker: 'रंग हल्का हरा है', buyer: 'The colour is light green' } },
    { field: 'size', status: 'cannot_verify', note: { maker: '', buyer: '' } },
    { field: 'item', status: 'differs', note: { maker: '', buyer: 'This looks like a dupatta, not a kurta' } },
  ],
  summary: { maker: 'यह जाँच सिर्फ़ सलाह है।', buyer: 'This check is advisory.' },
};

describe('vision normalization', () => {
  it('trims, fills a missing side from the other and drops empty details', () => {
    expect(validateReference(REFERENCE)).toBe(true);
    expect(normalizeReference(REFERENCE)).toEqual({
      description: { maker: 'हल्के हरे रंग का चिकनकारी कुर्ता', buyer: 'A light green chikankari kurta' },
      details: [{ aspect: 'neckline', value: { maker: 'गला: गोल', buyer: 'गला: गोल' } }],
    });
  });

  it('keeps every check with its status, and an empty note stays empty', () => {
    expect(validateProgress(PROGRESS)).toBe(true);
    const r = normalizeProgress(PROGRESS as Parameters<typeof normalizeProgress>[0]);
    expect(r.checks.map((c) => [c.field, c.status])).toEqual([
      ['color', 'matches'],
      ['size', 'cannot_verify'],
      ['item', 'differs'],
    ]);
    expect(r.checks[1]!.note).toEqual({ maker: '', buyer: '' });
    expect(r.checks[2]!.note.maker).toBe('This looks like a dupatta, not a kurta');
  });

  it('the schemas reject unknown statuses and fields', () => {
    expect(validateProgress({ ...PROGRESS, checks: [{ ...PROGRESS.checks[0], status: 'probably' }] })).toBe(false);
    expect(validateProgress({ ...PROGRESS, checks: [{ ...PROGRESS.checks[0], field: 'price' }] })).toBe(false);
  });
});

describe('createVision', () => {
  it('sends the agreement as context and the image inline, and falls back on invalid output', async () => {
    const reqs: ModelRequest[] = [];
    const callModel: CallModel = async (req) => {
      reqs.push(req);
      return req.model === 'fast' ? '{"checks": "not an array"}' : JSON.stringify(PROGRESS);
    };
    const r = await createVision({ callModel, settings }).checkProgress(spikeDeal(), IMAGE);
    expect(r.ai).toMatchObject({ model: 'slow', fallback: true });
    expect(r.attempts.map((a) => a.outcome)).toEqual(['invalid', 'ok']);
    expect(r.checks).toHaveLength(3);
    const parts = reqs[0]!.parts;
    expect(parts[0]!.text).toContain('Hand-embroidered chikankari kurta');
    expect(parts[0]!.text).toContain('Light green');
    expect(parts[1]!.inlineData).toEqual({ mimeType: 'image/jpeg', data: IMAGE.data.toString('base64') });
    expect(reqs[0]!.system).toMatch(/advisory/i);
    expect(reqs[0]!.system).toMatch(/cannot be verified/i);
    expect(reqs[0]!.thinkingLow).toBe(true);
  });

  it('describes a reference photo with the fast model', async () => {
    const r = await createVision({ callModel: async () => JSON.stringify(REFERENCE), settings }).describeReference(spikeDeal(), IMAGE);
    expect(r.ai).toMatchObject({ model: 'fast', fallback: false });
    expect(r.description.buyer).toBe('A light green chikankari kurta');
  });
});
