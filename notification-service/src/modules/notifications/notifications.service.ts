import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

type NotificationSeed = {
  id?: string;
  title: string;
  message: string;
  type: string;
  link?: string | null;
  createdAt?: Date;
};

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findMy(userId: string, page = 1, limit = 20, isRead?: boolean) {
    const skip = (page - 1) * limit;
    const where: Prisma.NotificationWhereInput = { userId };

    if (isRead !== undefined) {
      where.isRead = isRead;
    }

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        skip,
        take: limit,
        where,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      data: notifications,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUnreadCount(userId: string) {
    const unreadCount = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });

    return { unreadCount };
  }

  async markRead(userId: string, notificationId: string) {
    const existing = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!existing) {
      throw new NotFoundException('Notification not found');
    }

    if (existing.isRead) {
      return existing;
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return { updated: result.count };
  }

  async deleteMyNotification(userId: string, notificationId: string) {
    const existing = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!existing) {
      throw new ForbiddenException('Cannot delete this notification');
    }

    await this.prisma.notification.delete({
      where: { id: notificationId },
    });

    return { message: 'Notification deleted successfully' };
  }

  async create(data: Prisma.NotificationUncheckedCreateInput) {
    return this.prisma.notification.create({ data });
  }

  async findAll(page = 1, limit = 20, userId?: string) {
    const skip = (page - 1) * limit;
    const where: Prisma.NotificationWhereInput = {};

    if (userId) {
      where.userId = userId;
    }

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        skip,
        take: limit,
        where,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      data: notifications,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return notification;
  }

  async update(id: string, data: Prisma.NotificationUncheckedUpdateInput) {
    await this.findOne(id);
    return this.prisma.notification.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.notification.delete({
      where: { id },
    });
    return { message: 'Notification deleted successfully' };
  }

  async createFromEvent(userId: string, notification: NotificationSeed) {
    const data: Prisma.NotificationUncheckedCreateInput = {
      ...(notification.id ? { id: notification.id } : {}),
      userId,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      link: notification.link ?? null,
      createdAt: notification.createdAt ?? new Date(),
    };

    if (!notification.id) {
      return this.prisma.notification.create({ data });
    }

    return this.prisma.notification.upsert({
      where: { id: notification.id },
      create: data,
      update: {
        title: data.title,
        message: data.message,
        type: data.type,
        link: data.link,
      },
    });
  }

  async createManyForUsers(userIds: string[], notification: NotificationSeed) {
    const uniqueUserIds = Array.from(
      new Set(userIds.map((userId) => userId.trim()).filter(Boolean)),
    );

    if (uniqueUserIds.length === 0) {
      return { count: 0 };
    }

    return this.prisma.notification.createMany({
      data: uniqueUserIds.map((userId) => ({
        userId,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        link: notification.link ?? null,
        createdAt: notification.createdAt ?? new Date(),
      })),
    });
  }

  async getLatestForUsers(userIds: string[]) {
    return this.prisma.notification.findMany({
      where: {
        userId: {
          in: userIds,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async clearAll() {
    await this.prisma.notification.deleteMany();
  }
}
