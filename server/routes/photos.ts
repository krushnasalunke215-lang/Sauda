import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PhotoKind } from '../../shared/types.js';
import { normalizeImageMime } from '../ai/media.js';
import { ServiceError, type DealService } from '../deals/service.js';
import type { DealStore } from '../deals/store.js';
import { toView } from '../deals/view.js';
import { authenticate, params, short, type IdParams } from './deals.js';

export function photoRoutes(app: FastifyInstance, deps: { store: DealStore; service: DealService; publicBaseUrl: string | null }): void {
  const { store, service } = deps;
  const baseUrl = (req: FastifyRequest) => deps.publicBaseUrl ?? `${req.protocol}://${req.host}`;

  /** A raw image body (image/jpeg, image/png or image/webp, up to 6 MB). Vision runs in the background. */
  app.post<{ Params: IdParams; Querystring: { kind: PhotoKind }; Body: unknown }>(
    '/api/deals/:id/photos',
    {
      schema: {
        params: params(),
        querystring: { type: 'object', required: ['kind'], properties: { kind: { type: 'string', enum: ['reference', 'progress'] } } },
      },
    },
    async (req, reply) => {
      const { deal, role } = authenticate(store, req.params.id, req.headers['x-sauda-token']);
      const mimeType = normalizeImageMime(req.headers['content-type']);
      if (!mimeType || !Buffer.isBuffer(req.body)) throw new ServiceError(415, 'unsupported_media_type');
      const m = await service.addPhoto(deal.id, role, req.query.kind, { mimeType, data: req.body });
      return reply.code(202).send({ messageId: m.id, seq: m.seq });
    },
  );

  app.post<{ Params: IdParams & { mid: string }; Body: { approve: boolean } }>(
    '/api/deals/:id/photos/:mid/decision',
    {
      schema: {
        params: params({ mid: short }),
        body: { type: 'object', required: ['approve'], properties: { approve: { type: 'boolean' } } },
      },
    },
    async (req) => {
      const { deal, role } = authenticate(store, req.params.id, req.headers['x-sauda-token']);
      return toView(await service.decidePhoto(deal.id, role, req.params.mid, req.body.approve), role, baseUrl(req));
    },
  );
}
