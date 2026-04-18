import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Namespace, Server, Socket } from 'socket.io';
import { IncomingMessage } from 'http';
import {
  Logger,
  OnApplicationShutdown,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ENV, ENV_DEFAULTS } from '../../config/env.constants';
import { getAllowedOrigins, isAllowedOrigin } from '../../config/cors.util';
import { extractAccessTokenFromCookieHeader } from '../auth/auth-session.util';
import { AuthUser } from '../auth/types/auth-user.type';

interface AuthenticatedSocket extends Socket {
  data: {
    user?: AuthUser;
    authPromise?: Promise<AuthUser | null>;
  };
}

type JwtPayload = {
  sub: string;
  email: string;
  roles?: string[];
  permissions?: string[];
  studentId?: string | null;
  lecturerId?: string | null;
};

@WebSocketGateway({
  cors: {
    origin: Array.from(
      getAllowedOrigins(process.env.FRONTEND_URL ?? ENV_DEFAULTS.FRONTEND_URL),
    ),
    credentials: true,
  },
  namespace: '/notifications',
  maxHttpBufferSize: 1_000_000,
  allowRequest: (
    req: IncomingMessage,
    callback: (err: string | null, success: boolean) => void,
  ) => {
    const origin = req.headers.origin;
    const allowedOrigins = getAllowedOrigins(
      process.env.FRONTEND_URL ?? ENV_DEFAULTS.FRONTEND_URL,
    );
    callback(
      null,
      isAllowedOrigin(
        typeof origin === 'string' ? origin : undefined,
        allowedOrigins,
      ),
    );
  },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnApplicationShutdown
{
  @WebSocketServer()
  server!: Server | Namespace;

  private readonly logger = new Logger(NotificationsGateway.name);
  private readonly connectedClients = new Map<string, AuthenticatedSocket>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    const origin = this.extractOrigin(client);
    const allowedOrigins = getAllowedOrigins(
      this.configService.get<string>(ENV.FRONTEND_URL) ??
        ENV_DEFAULTS.FRONTEND_URL,
    );

    if (!isAllowedOrigin(origin, allowedOrigins)) {
      this.logger.warn(
        `Rejected socket ${client.id}: origin ${origin} is not allowed`,
      );
      client.disconnect(true);
      return;
    }

    client.data.authPromise = this.authenticateSocket(client);
    const user = await client.data.authPromise;

    if (!user) {
      client.disconnect(true);
      return;
    }

    client.data.user = user;
    this.connectedClients.set(client.id, client);
    client.join(`user:${user.id}`);

    for (const role of user.roles) {
      client.join(`role:${role}`);
    }

    this.logger.log(
      `Client connected: ${client.id} authenticated as ${user.id}`,
    );
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.connectedClients.delete(client.id);
  }

  async onApplicationShutdown() {
    this.connectedClients.clear();

    if (this.server && typeof (this.server as Server).close === 'function') {
      await (this.server as Server).close();
      return;
    }

    const namespaceServer = this.server as Namespace | undefined;
    if (namespaceServer?.server) {
      await namespaceServer.server.close();
    }
  }

  @SubscribeMessage('authenticate')
  async handleAuthentication(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: { channel?: string },
  ) {
    const user = await this.getAuthenticatedUser(client);

    if (!user) {
      return { status: 'unauthorized' };
    }

    if (data.channel && this.isAllowedChannel(user, data.channel)) {
      client.join(data.channel);
      this.logger.log(`Socket ${client.id} subscribed to ${data.channel}`);
    } else if (data.channel) {
      return {
        status: 'authenticated',
        userId: user.id,
        roles: user.roles,
        channelStatus: 'forbidden',
        channel: data.channel,
      };
    }

    return {
      status: 'authenticated',
      userId: user.id,
      roles: user.roles,
    };
  }

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { channel: string },
  ) {
    const user = await this.getAuthenticatedUser(client);

    if (!user) {
      return { status: 'unauthorized' };
    }

    if (data.channel && this.isAllowedChannel(user, data.channel)) {
      client.join(data.channel);
      return { status: 'subscribed', channel: data.channel };
    }

    return { status: 'forbidden', channel: data.channel };
  }

  @SubscribeMessage('unsubscribe')
  async handleUnsubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { channel: string },
  ) {
    const user = await this.getAuthenticatedUser(client);

    if (!user) {
      return { status: 'unauthorized' };
    }

    if (data.channel && this.isAllowedChannel(user, data.channel)) {
      client.leave(data.channel);
      return { status: 'unsubscribed', channel: data.channel };
    }

    return { status: 'forbidden', channel: data.channel };
  }

  sendNotificationToUser(
    userId: string,
    notification: Record<string, unknown>,
  ) {
    this.server.to(`user:${userId}`).emit('notification', notification);
  }

  sendNotificationToRole(role: string, notification: Record<string, unknown>) {
    this.server.to(`role:${role}`).emit('notification', notification);
  }

  sendAnnouncement(announcement: Record<string, unknown>) {
    this.server.emit('announcement', announcement);
  }

  private extractToken(client: AuthenticatedSocket) {
    const authToken =
      client.handshake.auth?.token ?? client.handshake.auth?.accessToken;
    const headerToken = client.handshake.headers?.authorization;
    const cookieHeader = client.handshake.headers?.cookie;

    if (typeof authToken === 'string' && authToken.trim()) {
      return this.normalizeBearerToken(authToken);
    }

    if (typeof headerToken === 'string' && headerToken.trim()) {
      return this.normalizeBearerToken(headerToken);
    }

    if (typeof cookieHeader === 'string' && cookieHeader.trim()) {
      return extractAccessTokenFromCookieHeader(cookieHeader);
    }

    return null;
  }

  private extractOrigin(client: AuthenticatedSocket) {
    const origin = client.handshake.headers?.origin;
    return typeof origin === 'string' ? origin : undefined;
  }

  private normalizeBearerToken(token: string) {
    return token.startsWith('Bearer ') ? token.slice(7) : token;
  }

  private async authenticateSocket(
    client: AuthenticatedSocket,
  ): Promise<AuthUser | null> {
    const token = this.extractToken(client);

    if (!token) {
      this.logger.warn(`Rejected socket ${client.id}: missing auth token`);
      return null;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);

      if (!payload?.sub || !payload?.email) {
        throw new UnauthorizedException('Invalid authentication token');
      }

      return {
        id: payload.sub,
        email: payload.email,
        roles: payload.roles ?? [],
        permissions: payload.permissions ?? [],
        studentId: payload.studentId ?? null,
        lecturerId: payload.lecturerId ?? null,
      };
    } catch {
      this.logger.warn(
        `Rejected socket ${client.id}: invalid authentication token`,
      );
      return null;
    }
  }

  private async getAuthenticatedUser(client: AuthenticatedSocket) {
    if (client.data.user) {
      return client.data.user;
    }

    if (!client.data.authPromise) {
      return null;
    }

    const user = await client.data.authPromise.catch(() => null);
    if (user) {
      client.data.user = user;
    }

    return user;
  }

  private isAllowedChannel(user: AuthUser, channel: string) {
    const allowedChannels = new Set<string>([
      'announcements',
      `user:${user.id}`,
      ...user.roles.map((role) => `role:${role}`),
    ]);

    return allowedChannels.has(channel);
  }
}
