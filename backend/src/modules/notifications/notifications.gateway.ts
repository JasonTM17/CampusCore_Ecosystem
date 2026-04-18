import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
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
import { AuthService } from '../auth/auth.service';
import { AuthUser } from '../auth/types/auth-user.type';
import { ENV, ENV_DEFAULTS } from '../../config/env.constants';
import { getAllowedOrigins, isAllowedOrigin } from '../../config/cors.util';

interface AuthenticatedSocket extends Socket {
  data: {
    user?: AuthUser;
    authPromise?: Promise<AuthUser | null>;
  };
}

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
  server: Server | Namespace;

  private readonly logger = new Logger(NotificationsGateway.name);
  private connectedClients: Map<string, AuthenticatedSocket> = new Map();

  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
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

    try {
      client.data.user = user;
      this.connectedClients.set(client.id, client);
      client.join(`user:${user.id}`);

      for (const role of user.roles) {
        client.join(`role:${role}`);
      }

      this.logger.log(
        `Client connected: ${client.id} authenticated as ${user.id}`,
      );
    } catch {
      this.logger.warn(
        `Rejected socket ${client.id}: invalid authentication token`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.log(`Client disconnected: ${client.id}`);
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
    data: { channel?: string; userId?: string; role?: string },
  ) {
    const user = await this.getAuthenticatedUser(client);

    if (!user) {
      return { status: 'unauthorized' };
    }

    if (data.channel && this.isAllowedChannel(user, data.channel)) {
      client.join(data.channel);
      this.logger.log(`Socket ${client.id} subscribed to ${data.channel}`);
    } else if (data.channel) {
      this.logger.warn(
        `Socket ${client.id} attempted forbidden channel join: ${data.channel}`,
      );
      return {
        status: 'authenticated',
        userId: user.id,
        roles: user.roles,
        channelStatus: 'forbidden',
        channel: data.channel,
      };
    }

    return { status: 'authenticated', userId: user.id, roles: user.roles };
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
      this.logger.log(`Socket ${client.id} subscribed to ${data.channel}`);
      return { status: 'subscribed', channel: data.channel };
    }

    this.logger.warn(
      `Socket ${client.id} attempted forbidden subscribe: ${data.channel}`,
    );
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
      this.logger.log(`Socket ${client.id} unsubscribed from ${data.channel}`);
      return { status: 'unsubscribed', channel: data.channel };
    }

    this.logger.warn(
      `Socket ${client.id} attempted forbidden unsubscribe: ${data.channel}`,
    );
    return { status: 'forbidden', channel: data.channel };
  }

  sendNotificationToUser(userId: string, notification: any) {
    this.server.to(`user:${userId}`).emit('notification', notification);
    this.logger.log(
      `Notification sent to user ${userId}: ${notification.title}`,
    );
  }

  sendNotificationToRole(role: string, notification: any) {
    this.server.to(`role:${role}`).emit('notification', notification);
    this.logger.log(`Notification sent to role ${role}: ${notification.title}`);
  }

  sendAnnouncement(announcement: any) {
    this.server.emit('announcement', announcement);
    this.logger.log(`Announcement broadcast: ${announcement.title}`);
  }

  sendToAll(channel: string, event: string, data: any) {
    this.server.to(channel).emit(event, data);
  }

  getConnectedClientsCount(): number {
    return this.connectedClients.size;
  }

  private extractToken(client: AuthenticatedSocket) {
    const authToken =
      client.handshake.auth?.token ?? client.handshake.auth?.accessToken;
    const headerToken = client.handshake.headers?.authorization;

    if (typeof authToken === 'string' && authToken.trim()) {
      return this.normalizeBearerToken(authToken);
    }

    if (typeof headerToken === 'string' && headerToken.trim()) {
      return this.normalizeBearerToken(headerToken);
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
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(token);
      const user = await this.authService.validateUser(payload.sub);

      if (!user) {
        throw new UnauthorizedException('Inactive user');
      }

      return user;
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
