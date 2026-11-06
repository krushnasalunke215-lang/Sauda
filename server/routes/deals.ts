import type { FastifyInstance, FastifyRequest } from 'fastify';
import { LANGS, type CreateDealResult, type Deal, type Role } from '../../shared/types.js';
import { normalizeAudioMime } from '../ai/media.js';
import { MAX_NAME_CHARS, ServiceError, type DealService } from '../deals/service.js';
import type { DealStore } from '../deals/store.js';
import { invitePath, toView } from '../deals/view.js';
import type { SampleLibrary } from './samples.js';

export interface DealRouteDeps {
  store: DealStore;
  service: DealService;
  samples: SampleLibrary;
  publicBaseUrl: string | null;
}

const idParam = { type: 'string', pattern: '^[0-9A-Z]{8}$' } as const;
export const params = (extra: Record<string, object> = {}) => ({
  type: 'object',
  required: ['id', ...Object.keys(extra)],
  properties: { id: idParam, ...extra },
});
export const short = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$' } as const;

export type IdParams = { id: string };

/** The deal and role for a token (X-Sauda-Token header, or ?t= for media); 403 for a wrong token or an unknown deal. */
export function authenticate(store: DealStore, dealId: string, token: unknown): { deal: Deal; role: Role } {
  const found = typeof token === 'string' ? store.findByToken(dealId, token) : null;
  if (!found) throw new ServiceError(403, 'forbidden');
  return found;
}

export function dealRoutes(app: FastifyInstance, deps: DealRouteDeps): void {
  const { store, service } = deps;
  const baseUrl = (req: FastifyRequest) => deps.publicBaseUrl ?? `${req.protocol}://${req.host}`;

  const auth = (req: FastifyRequest<{ Params: IdParams }>) => authenticate(store, req.params.id, req.headers['x-sauda-token']);

  app.post(
    '/api/deals',
    {
      schema: {
        body: {
          type: 'object',
          required: ['makerName', 'makerLang', 'buyerName', 'buyerLang'],
          properties: {
            makerName: { type: 'string', minLength: 1, maxLength: MAX_NAME_CHARS },
            makerLang: { type: 'string', enum: [...LANGS] },
            buyerName: { type: 'string', minLength: 1, maxLength: MAX_NAME_CHARS },
            buyerLang: { type: 'string', enum: [...LANGS] },
          },
        },
      },
    },
    async (req, reply) => {
      const deal = service.createDeal(req.body);
      const base = baseUrl(req);
      const result: CreateDealResult = {
        id: deal.id,
        maker: { url: invitePath(deal, 'maker', base), token: deal.tokens.maker },
        buyer: { url: invitePath(deal, 'buyer', base), token: deal.tokens.buyer },
      };
      return reply.code(201).send(result);
    },
  );

  app.get<{ Params: IdParams }>('/api/deals/:id', { schema: { params: params() } }, async (req) => {
    const { deal, role } = auth(req);
    return toView(deal, role, baseUrl(req));
  });

  /**
   * One turn: JSON {text}, a raw audio body (audio/* or video/mp4, up to 4 MB), or ?sample=<id> for a
   * built-in clip of the caller's role. Interpretation runs in the background.
   */
  app.post<{ Params: IdParams; Querystring: { sample?: string }; Body: unknown }>(
    '/api/deals/:id/turns',
    { schema: { params: params(), querystring: { type: 'object', properties: { sample: short } } } },
    async (req, reply) => {
      const { deal, role } = auth(req);
      let m;
      if (req.query.sample) {
        const s = deps.samples.get(req.query.sample);
        if (!s || s.kind !== 'voice') throw new ServiceError(404, 'sample_not_found');
        if (s.role !== role) throw new ServiceError(403, 'sample_wrong_role');
        m = await service.addVoiceTurn(deal.id, role, await deps.samples.readAudio(s), { sample: s.id });
      } else if (Buffer.isBuffer(req.body)) {
        const mimeType = normalizeAudioMime(req.headers['content-type']);
        if (!mimeType) throw new ServiceError(415, 'unsupported_media_type');
        m = await service.addVoiceTurn(deal.id, role, { mimeType, data: req.body });
      } else {
        const body = req.body as { text?: unknown } | null | undefined;
        m = await service.addTextTurn(deal.id, role, body && typeof body === 'object' ? body.text : undefined);
      }
      return reply.code(202).send({ messageId: m.id, seq: m.seq });
    },
  );

  app.post<{ Params: IdParams & { mid: string } }>(
    '/api/deals/:id/turns/:mid/retry',
    { schema: { params: params({ mid: short }) } },
    async (req, reply) => {
      const { deal, role } = auth(req);
      const m = await service.retryTurn(deal.id, role, req.params.mid);
      return reply.code(202).send({ messageId: m.id, seq: m.seq });
    },
  );

  app.post<{ Params: IdParams & { qid: string } }>(
    '/api/deals/:id/questions/:qid/dismiss',
    { schema: { params: params({ qid: short }) } },
    async (req) => {
      const { deal, role } = auth(req);
      return toView(await service.dismissQuestion(deal.id, role, req.params.qid), role, baseUrl(req));
    },
  );

  app.post<{ Params: IdParams; Body: { hash: string } }>(
    '/api/deals/:id/confirm',
    {
      schema: {
        params: params(),
        body: { type: 'object', required: ['hash'], properties: { hash: { type: 'string', pattern: '^[0-9a-f]{64}$' } } },
      },
    },
    async (req) => {
      const { deal, role } = auth(req);
      return toView(await service.confirm(deal.id, role, req.body.hash), role, baseUrl(req));
    },
  );
}
