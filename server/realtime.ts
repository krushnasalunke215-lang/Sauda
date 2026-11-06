import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { ROLES, type Role } from '../shared/types.js';
import type { DealStore } from './deals/store.js';
import { toView } from './deals/view.js';

const room = (dealId: string, role: Role) => `deal:${dealId}:${role}`;

/**
 * Socket.IO on the Fastify server. A client connects with auth {dealId, token}, joins its role's
 * room and receives a full role-filtered 'deal' snapshot on connect and after every change.
 */
export function attachRealtime(app: FastifyInstance, store: DealStore, baseUrl: string | null): Server {
  const io = new Server(app.server, { serveClient: false });

  io.use((socket, next) => {
    const { dealId, token } = (socket.handshake.auth ?? {}) as { dealId?: unknown; token?: unknown };
    const found = typeof dealId === 'string' && typeof token === 'string' ? store.findByToken(dealId, token) : null;
    if (!found) return next(new Error('forbidden'));
    socket.data.dealId = found.deal.id;
    socket.data.role = found.role;
    next();
  });

  io.on('connection', (socket) => {
    const { dealId, role } = socket.data as { dealId: string; role: Role };
    void socket.join(room(dealId, role));
    const deal = store.get(dealId);
    if (deal) socket.emit('deal', toView(deal, role, baseUrl));
  });

  store.onChange((deal) => {
    for (const role of ROLES) io.to(room(deal.id, role)).emit('deal', toView(deal, role, baseUrl));
  });

  return io;
}
