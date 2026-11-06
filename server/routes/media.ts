import type { FastifyInstance } from 'fastify';
import { MEDIA_FILE_RE, serveType } from '../ai/media.js';
import { ServiceError, type DealService } from '../deals/service.js';
import type { DealStore } from '../deals/store.js';
import { authenticate, params, short, type IdParams } from './deals.js';

/**
 * Serves uploads and synthesized speech. The token travels as ?t= because <audio> and <img> cannot
 * send headers (the request logger redacts it).
 */
export function mediaRoutes(app: FastifyInstance, deps: { store: DealStore; service: DealService }): void {
  const { store, service } = deps;

  app.get<{ Params: IdParams & { file: string }; Querystring: { t?: string } }>(
    '/api/deals/:id/media/:file',
    { schema: { params: params({ file: { type: 'string', maxLength: 80 } }) } },
    async (req, reply) => {
      const { file } = req.params;
      if (!MEDIA_FILE_RE.test(file)) throw new ServiceError(400, 'invalid_file');
      const { deal } = authenticate(store, req.params.id, req.query.t);
      const data = await service.readMedia(deal.id, file).catch(() => null);
      if (!data) throw new ServiceError(404, 'not_found');
      return reply.type(serveType(file)).header('Cache-Control', 'private, max-age=86400').send(data);
    },
  );

  app.get<{ Params: IdParams & { mid: string }; Querystring: { t?: string } }>(
    '/api/deals/:id/messages/:mid/tts',
    { schema: { params: params({ mid: short }) } },
    async (req, reply) => {
      const { deal } = authenticate(store, req.params.id, req.query.t);
      const wav = await service.translationSpeech(deal, req.params.mid);
      return reply.type('audio/wav').header('Cache-Control', 'private, max-age=86400').send(wav);
    },
  );
}
