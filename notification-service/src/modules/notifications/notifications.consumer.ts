import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import {
  NOTIFICATION_EVENTS_QUEUE,
  NOTIFICATION_EVENT_TYPES,
  NotificationEventEnvelope,
} from '../rabbitmq/rabbitmq.events';

type NotificationEventPayload = {
  userId?: string;
  role?: string;
  userIds?: string[];
  notification?: {
    id?: string;
    title: string;
    message: string;
    type: string;
    link?: string | null;
    createdAt?: string;
  };
  announcement?: Record<string, unknown>;
  invoice?: Record<string, unknown>;
  payment?: Record<string, unknown>;
};

@Injectable()
export class NotificationsConsumer implements OnModuleInit {
  private readonly logger = new Logger(NotificationsConsumer.name);

  constructor(
    private readonly rabbitMQService: RabbitMQService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  async onModuleInit() {
    await this.rabbitMQService.consumeMessages(
      NOTIFICATION_EVENTS_QUEUE,
      async (message) => {
        await this.handleEvent(
          message as unknown as NotificationEventEnvelope<NotificationEventPayload>,
        );
      },
    );
  }

  private async handleEvent(
    event: NotificationEventEnvelope<NotificationEventPayload>,
  ) {
    switch (event.type) {
      case NOTIFICATION_EVENT_TYPES.ANNOUNCEMENT_CREATED:
        if (event.payload.announcement) {
          this.notificationsGateway.sendAnnouncement(
            event.payload.announcement,
          );
        }
        return;

      case NOTIFICATION_EVENT_TYPES.NOTIFICATION_USER_CREATED:
        await this.handleUserNotification(event.payload);
        return;

      case NOTIFICATION_EVENT_TYPES.NOTIFICATION_ROLE_CREATED:
        await this.handleRoleNotification(event.payload);
        return;

      case NOTIFICATION_EVENT_TYPES.INVOICE_CREATED:
      case NOTIFICATION_EVENT_TYPES.PAYMENT_COMPLETED:
        await this.handleUserNotification(event.payload);
        return;

      default:
        this.logger.warn(
          `Ignoring unsupported notification event: ${event.type}`,
        );
    }
  }

  private async handleUserNotification(payload: NotificationEventPayload) {
    if (!payload.userId || !payload.notification) {
      this.logger.warn(
        'notification.user.created missing userId or notification payload',
      );
      return;
    }

    const created = await this.notificationsService.createFromEvent(
      payload.userId,
      {
        ...payload.notification,
        createdAt: payload.notification.createdAt
          ? new Date(payload.notification.createdAt)
          : undefined,
      },
    );

    this.notificationsGateway.sendNotificationToUser(payload.userId, created);
  }

  private async handleRoleNotification(payload: NotificationEventPayload) {
    if (!payload.role || !payload.notification) {
      this.logger.warn(
        'notification.role.created missing role or notification payload',
      );
      return;
    }

    const createdAt = payload.notification.createdAt
      ? new Date(payload.notification.createdAt)
      : undefined;
    const userIds = payload.userIds ?? [];

    await this.notificationsService.createManyForUsers(userIds, {
      ...payload.notification,
      createdAt,
    });

    this.notificationsGateway.sendNotificationToRole(payload.role, {
      ...payload.notification,
      role: payload.role,
      userIds,
      createdAt: createdAt?.toISOString() ?? null,
    });
  }
}
