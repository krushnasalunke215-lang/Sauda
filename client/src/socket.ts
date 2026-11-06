import { io } from 'socket.io-client';
import type { DealView } from '../../shared/types.js';

export type SocketStatus = 'connecting' | 'connected' | 'disconnected' | 'forbidden';

/** Subscribes to the role-filtered 'deal' snapshots of one deal. Returns an unsubscribe function. */
export function subscribeDeal(
  dealId: string,
  token: string,
  handlers: { onDeal: (v: DealView) => void; onStatus: (s: SocketStatus) => void },
): () => void {
  const socket = io({ auth: { dealId, token } });
  socket.on('deal', handlers.onDeal);
  socket.on('connect', () => handlers.onStatus('connected'));
  socket.on('disconnect', () => handlers.onStatus('disconnected'));
  socket.on('connect_error', (err) => {
    if (err.message === 'forbidden') {
      handlers.onStatus('forbidden');
      socket.disconnect();
    } else handlers.onStatus('disconnected');
  });
  return () => {
    socket.disconnect();
  };
}
