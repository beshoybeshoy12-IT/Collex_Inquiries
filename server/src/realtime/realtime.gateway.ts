import { Logger, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { envList, requireEnv } from '../common/config/env';
import type { JwtPayload } from '../auth/token.service';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Realtime updates.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  WHAT GOES DOWN THIS SOCKET, AND WHAT DOES NOT.
 *
 *  Sockets carry *signals*, not data: "case 47 changed status", not the case.
 *  The client refetches through the REST API, which is where filtering,
 *  pagination and — critically — permission checks live. Pushing the record
 *  itself would mean re-implementing visibility rules in the gateway, and the
 *  second implementation is the one that leaks.
 *
 *  Ordinary CRUD does not belong here either. A coordinator saving a comment
 *  gets an HTTP response; the socket exists for things that happen *to* a user
 *  while they are looking elsewhere — an assignment arriving, a QC verdict, an
 *  import finishing, an SLA breaching.
 *
 *  ROOMS
 *
 *    tenant:<id>     every connected client of one company
 *    principal:<id>  one user or investigator, across their open tabs
 *
 *  Tenant is the coarse channel and is safe because a tenant room never
 *  contains a member of another tenant — the handshake puts each socket in
 *  exactly the rooms its verified token allows, and there is no client-supplied
 *  room name anywhere in this file.
 *
 *  SCALING. socket.io here has no Redis adapter, so an emit reaches only the
 *  clients connected to this process. At more than one replica that is a real
 *  limitation, stated plainly at boot rather than discovered in production; the
 *  fix is `@socket.io/redis-adapter`, and the Redis connection it needs is
 *  already configured for BullMQ.
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    origin: envList('CORS_ORIGINS', [
      'http://localhost:5174',
      'http://127.0.0.1:5174',
    ]),
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly jwt: JwtService) {}

  onModuleInit(): void {
    this.logger.log('Realtime gateway listening on /realtime');
  }

  /**
   * Authenticate on connect, then join rooms.
   *
   * The token is verified here rather than trusted from a query parameter that
   * merely claims a user id: a socket that skipped this would be an
   * unauthenticated subscription to a tenant's entire event stream.
   */
  async handleConnection(client: Socket): Promise<void> {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ??
        this.bearerFrom(client.handshake.headers.authorization);

      if (!token) {
        client.disconnect(true);
        return;
      }

      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: requireEnv('JWT_SECRET'),
      });

      // Stored on the socket so a later message handler does not have to
      // re-verify, and so disconnect can log who left.
      client.data.principalId = payload.sub;
      client.data.tenantId = payload.tid;
      client.data.principalType = payload.typ;

      await client.join(`tenant:${payload.tid}`);
      await client.join(`principal:${payload.sub}`);

      client.emit('connected', {
        principalId: payload.sub,
        tenantId: payload.tid,
      });
    } catch {
      // An expired or forged token is not an incident worth a stack trace —
      // clients reconnect with a stale token routinely.
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    // socket.io removes the socket from its rooms itself; nothing to undo.
    void client;
  }

  /**
   * A client watching one case asks for its events specifically.
   *
   * The case id is client-supplied, so this room is *namespaced under the
   * verified tenant*: `case:<tenant>:<case>`. Without that, a client could join
   * another tenant's case room by guessing an id, and emits to it would reach
   * them.
   */
  @SubscribeMessage('watch:investigation')
  async watchInvestigation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { investigationId?: string },
  ): Promise<{ watching: string | null }> {
    const tenantId = client.data.tenantId as string | undefined;
    const id = data?.investigationId;

    if (!tenantId || !id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return { watching: null };
    }

    await client.join(`case:${tenantId}:${id}`);
    return { watching: id };
  }

  @SubscribeMessage('unwatch:investigation')
  async unwatchInvestigation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { investigationId?: string },
  ): Promise<{ ok: boolean }> {
    const tenantId = client.data.tenantId as string | undefined;
    if (tenantId && data?.investigationId) {
      await client.leave(`case:${tenantId}:${data.investigationId}`);
    }
    return { ok: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Emit helpers — the only way the rest of the app reaches the socket
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Every method below tolerates `this.server` being undefined.
   *
   * The gateway is not initialised in the worker process, and services shared
   * between the two call these freely. A guard here is the difference between
   * "the PDF worker emits nothing" and "the PDF worker crashes on every job".
   */
  emitToTenant(tenantId: string, event: string, payload: unknown): void {
    this.server?.to(`tenant:${tenantId}`).emit(event, payload);
  }

  emitToPrincipal(principalId: string, event: string, payload: unknown): void {
    this.server?.to(`principal:${principalId}`).emit(event, payload);
  }

  emitToInvestigation(
    tenantId: string,
    investigationId: string,
    event: string,
    payload: unknown,
  ): void {
    this.server?.to(`case:${tenantId}:${investigationId}`).emit(event, payload);
  }

  /** Progress for a long-running job the user is watching — import, export. */
  emitProgress(
    principalId: string,
    job: string,
    progress: { percent: number; message?: string; done?: boolean },
  ): void {
    this.emitToPrincipal(principalId, `${job}:progress`, progress);
  }

  private bearerFrom(header?: string): string | undefined {
    if (!header?.startsWith('Bearer ')) return undefined;
    return header.slice(7);
  }
}
