import type { FastifyInstance, FastifyRequest } from 'fastify';
import { LANGS, type CreateDealResult, type Deal, type Role } from '../../shared/types.js';
import { MAX_NAME_CHARS, MAX_TEXT_CHARS, ServiceError, type DealService } from '../deals/service.js';
import type { DealStore } from '../deals/store.js';
import { invitePath, toView } from '../deals/view.js';

export interface DealRouteDeps {
  store: DealStore;
  service: DealService;
  publicBaseUrl: string | null;
}

const idParam = { type: 'string', pattern: '^[0-9A-Z]{8}$' } as const;
const params = (extra: Record<string, object> = {}) => ({
  type: 'object',
  required: ['id', ...Object.keys(extra)],
  properties: { id: idParam, ...extra },
});
const short = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$' } as const;

type IdParams = { id: string };

export function dealRoutes(app: FastifyInstance, deps: DealRouteDeps): void {
  const { store, service } = deps;
  const baseUrl = (req: FastifyRequest) => deps.publicBaseUrl ?? `${req.protocol}://${req.host}`;

  /** The deal and role for the X-Sauda-Token header; 403 for a wrong token or an unknown deal. */
  const auth = (req: FastifyRequest<{ Params: IdParams }>): { deal: Deal; role: Role } => {
    const token = req.headers['x-sauda-token'];
    const found = typeof token === 'string' ? store.findByToken(req.params.id, token) : null;
    if (!found) throw new ServiceError(403, 'forbidden');
    return found;
  };

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

  app.post<{ Params: IdParams; Body: { text: string } }>(
    '/api/deals/:id/turns',
    {
      schema: {
        params: params(),
        body: { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: MAX_TEXT_CHARS } } },
      },
    },
    async (req, reply) => {
      const { deal, role } = auth(req);
      const m = await service.addTextTurn(deal.id, role, req.body.text);
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
