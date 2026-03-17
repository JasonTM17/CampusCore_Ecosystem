import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userRole?: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/notifications',
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);
  private connectedClients: Map<string, AuthenticatedSocket> = new Map();

  handleConnection(client: AuthenticatedSocket) {
    this.logger.log(`Client connected: ${client.id}`);
    this.connectedClients.set(client.id, client);
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.connectedClients.delete(client.id);
  }

  @SubscribeMessage('authenticate')
  handleAuthentication(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { userId: string; role: string },
  ) {
    client.userId = data.userId;
    client.userRole = data.role;
    client.join(`user:${data.userId}`);
    client.join(`role:${data.role}`);
    
    this.logger.log(`User ${data.userId} (${data.role}) authenticated on socket ${client.id}`);
    
    return { status: 'authenticated', userId: data.userId };
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { channel: string },
  ) {
    if (data.channel) {
      client.join(data.channel);
      this.logger.log(`Socket ${client.id} subscribed to ${data.channel}`);
    }
    return { status: 'subscribed', channel: data.channel };
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { channel: string },
  ) {
    if (data.channel) {
      client.leave(data.channel);
      this.logger.log(`Socket ${client.id} unsubscribed from ${data.channel}`);
    }
    return { status: 'unsubscribed', channel: data.channel };
  }

  sendNotificationToUser(userId: string, notification: any) {
    this.server.to(`user:${userId}`).emit('notification', notification);
    this.logger.log(`Notification sent to user ${userId}: ${notification.title}`);
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
}
