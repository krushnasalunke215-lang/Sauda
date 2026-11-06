import type { Bi, Deal, PhotoCheck } from '../../shared/types.js';
import { generateJson, type Attempt, type GenerateDeps, type Part } from './gemini.js';
import type { ImageMime } from './media.js';
import { normBi } from './interpret.js';
import { buildVisionContext, PROGRESS_SYSTEM, REFERENCE_SYSTEM } from './prompts.js';
import { PROGRESS_SCHEMA, REFERENCE_SCHEMA, validateProgress, validateReference, type ProgressOutput, type ReferenceOutput } from './schemas.js';

export interface ImageInput {
  mimeType: ImageMime;
  data: Buffer;
}

interface AiMeta {
  ai: { model: string; ms: number; fallback: boolean };
  attempts: Attempt[];
}

export interface ReferenceResult extends AiMeta {
  description: Bi;
  details: { aspect: string; value: Bi }[];
}

export interface ProgressResult extends AiMeta {
  checks: PhotoCheck[];
  summary: Bi;
}

/** Gemini vision, injected into the deal service so tests can fake it. */
export interface Vision {
  describeReference(deal: Deal, image: ImageInput): Promise<ReferenceResult>;
  checkProgress(deal: Deal, image: ImageInput): Promise<ProgressResult>;
}

const MAX_DETAILS = 6;
const MAX_CHECKS = 8;
const EMPTY: Bi = { maker: '', buyer: '' };

export function normalizeReference(out: ReferenceOutput): Omit<ReferenceResult, keyof AiMeta> {
  return {
    description: normBi(out.description) ?? EMPTY,
    details: out.details
      .flatMap((d) => {
        const value = normBi(d.value);
        return value ? [{ aspect: d.aspect.trim().toLowerCase() || 'other', value }] : [];
      })
      .slice(0, MAX_DETAILS),
  };
}

export function normalizeProgress(out: ProgressOutput): Omit<ProgressResult, keyof AiMeta> {
  return {
    checks: out.checks.map((c) => ({ field: c.field, status: c.status, note: normBi(c.note) ?? EMPTY })).slice(0, MAX_CHECKS),
    summary: normBi(out.summary) ?? EMPTY,
  };
}

const parts = (deal: Deal, image: ImageInput, what: string): Part[] => [
  { text: `Deal context (JSON):\n${buildVisionContext(deal)}` },
  { inlineData: { mimeType: image.mimeType, data: image.data.toString('base64') } },
  { text: what },
];

export function createVision(deps: GenerateDeps): Vision {
  return {
    async describeReference(deal, image) {
      const r = await generateJson<ReferenceOutput>(
        { label: 'reference_photo', parts: parts(deal, image, 'The photo is the buyer\'s reference photo.'), system: REFERENCE_SYSTEM, schema: REFERENCE_SCHEMA, validate: validateReference },
        deps,
      );
      return { ...normalizeReference(r.data), ai: { model: r.model, ms: r.ms, fallback: r.fallback }, attempts: r.attempts };
    },
    async checkProgress(deal, image) {
      const r = await generateJson<ProgressOutput>(
        { label: 'progress_photo', parts: parts(deal, image, 'The photo is the maker\'s progress photo of the order.'), system: PROGRESS_SYSTEM, schema: PROGRESS_SCHEMA, validate: validateProgress },
        deps,
      );
      return { ...normalizeProgress(r.data), ai: { model: r.model, ms: r.ms, fallback: r.fallback }, attempts: r.attempts };
    },
  };
}
