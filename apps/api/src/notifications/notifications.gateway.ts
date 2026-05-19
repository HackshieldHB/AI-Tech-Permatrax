import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Inject, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.provider';

/**
 * Permit-flow events (rooms: `user:{id}`, `role:{Role}`, or broadcast):
 * permitCluster:created, permitCluster:phaseAdvanced, permitCluster:constructionReady,
 * cluster:phaseAdvanced, cluster:permitDone,
 * baSurvey:generated, sip:submittedToIsp, sip:ispApproved, sip:ispRejected,
 * hld:submittedToIsp, hld:ispApproved, hld:revisionRequired,
 * lld:ispApproved, lld:revisionRequired,
 * skomBudget:pendingApproval, skomBudget:approved,
 * invoice:submitted, invoice:paid,
 * apd:drmScheduled, apd:drmApproved, apd:revisionRequired,
 * abd:submittedToIsp, abd:ispApproved, abd:ispRevisionRequired,
 * socialization:documentsGenerated, bak:autoApproved, bak:pendingApproval, bak:approved, bak:rejected,
 * signature:invalid, signatures:allValid, scom:completed,
 * bakp:paymentUploaded, bakp:submittedForValidation, bakp:approved, bakp:revisionRequired
 */
// FIX: support comma-separated CORS allowlist (matches HTTP CORS config)
function resolveWsCorsOrigins(): string | string[] {
  const origins = (process.env.CORS_ALLOWED_ORIGINS ?? process.env.FRONTEND_URL ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return origins.length === 1 ? origins[0] : origins;
}

@WebSocketGateway({
  cors: {
    origin: resolveWsCorsOrigins(),
    credentials: true,
  },
})
export class NotificationsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;
  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly jwtService: JwtService, // FIX: verify WebSocket register tokens
  ) {}

  afterInit(server: Server) { // NEW: attach Redis adapter once gateway is initialized
    const pubClient = this.redis.duplicate(); // NEW: pub connection for adapter
    const subClient = this.redis.duplicate(); // NEW: sub connection for adapter
    server.adapter(createAdapter(pubClient, subClient)); // FIX: synchronize Socket.IO events across PM2 workers
    this.logger.log('Socket.IO Redis adapter attached'); // NEW: startup verification log
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`); // MODIFIED: use logger instead of console
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`); // MODIFIED: use logger instead of console
  }

  // FIX: verify JWT from handshake — do NOT trust userId/role from client payload
  @SubscribeMessage('register')
  handleRegister(
    @MessageBody() _data: unknown, // payload ignored — identity comes from verified JWT
    @ConnectedSocket() client: Socket,
  ) {
    const rawToken =
      (client.handshake.auth as Record<string, unknown>)?.token as string | undefined ??
      client.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');

    if (!rawToken) {
      this.logger.warn(`[WS] register attempt without token from ${client.id}`);
      client.emit('error', { message: 'Authentication required' });
      client.disconnect(true);
      return { status: 'error', message: 'Authentication required' };
    }

    try {
      const payload = this.jwtService.verify<{ sub: string; role: string }>(rawToken);
      const userId = payload.sub;
      const role = payload.role;
      if (userId) {
        client.join(`user:${userId}`);
        this.logger.debug(`${client.id} joined room user:${userId}`);
      }
      if (role) {
        client.join(`role:${role}`);
        this.logger.debug(`${client.id} joined room role:${role}`);
      }
      return { status: 'registered', rooms: [`user:${userId}`, `role:${role}`] };
    } catch (err) {
      this.logger.warn(`[WS] Invalid/expired token from ${client.id}: ${(err as Error).message}`);
      client.emit('error', { message: 'Invalid or expired token' });
      client.disconnect(true);
      return { status: 'error', message: 'Invalid or expired token' };
    }
  }

  emitToRoom(room: string, event: string, payload: any) {
    this.server.to(room).emit(event, payload);
  }

  emitToAll(event: string, payload: any) {
    this.server.emit(event, payload);
  }

  emitToRooms(rooms: string[], event: string, payload: any) {
    rooms.forEach((room) => this.server.to(room).emit(event, payload));
  }

  /**
   * Legacy method -- kept for backward compatibility with existing SLA processor calls
   * @deprecated Use emitToRoom or emitToAll instead
   */
  notifyClient(event: string, payload: any) {
    this.server.emit(event, payload);
  }
}
