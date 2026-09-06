import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { tokenStore } from '../services/api';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The realtime connection.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ONE SOCKET FOR THE WHOLE APPLICATION, shared by every hook. A socket per
 *  component would mean a dozen connections per tab, a dozen handshakes on
 *  every navigation, and a server counting each user a dozen times.
 *
 *  WHAT ARRIVES ARE SIGNALS, NOT DATA. An event says "case 47 changed"; the
 *  handler invalidates a query and React Query refetches through the REST API,
 *  where filtering and — critically — permission checks live. Trusting a
 *  payload pushed down a socket would mean re-implementing visibility rules in
 *  the gateway, and the second implementation is the one that leaks.
 *
 *  A dropped connection is not an error state here. Every screen that listens
 *  also polls or refetches on its own; the socket makes updates immediate
 *  rather than being the only way they arrive.
 */

let socket = null;
let refCount = 0;

function getSocket() {
  if (socket) return socket;

  socket = io('/realtime', {
    // The handshake carries the access token; the gateway verifies it and
    // refuses the connection outright if it does not check out.
    auth: { token: tokenStore.access },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });

  return socket;
}

/** Subscribe to one server event for the lifetime of the component. */
export function useRealtime(event, handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!tokenStore.access) return undefined;

    const connection = getSocket();
    refCount += 1;

    // Called through the ref so a handler that closes over fresh props does
    // not need the listener re-registering on every render.
    const listener = (payload) => handlerRef.current?.(payload);
    connection.on(event, listener);

    return () => {
      connection.off(event, listener);
      refCount -= 1;

      // Tear the connection down only when nothing is listening any more —
      // otherwise navigating between two screens that both listen would close
      // and reopen the socket on every transition.
      if (refCount <= 0) {
        connection.disconnect();
        socket = null;
        refCount = 0;
      }
    };
  }, [event]);
}

/** Ask the server to send this case's events to this client. */
export function useWatchInvestigation(investigationId) {
  useEffect(() => {
    if (!investigationId || !tokenStore.access) return undefined;

    const connection = getSocket();
    connection.emit('watch:investigation', { investigationId });

    return () => {
      connection.emit('unwatch:investigation', { investigationId });
    };
  }, [investigationId]);
}
