import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const mockPrisma = {
    notification: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    jest.clearAllMocks();
  });

  describe('findMy', () => {
    it('should return paginated notifications for user', async () => {
      const userId = 'user-uuid';
      const mockNotifications = [
        { id: '1', userId, title: 'Notification 1', isRead: false },
        { id: '2', userId, title: 'Notification 2', isRead: true },
      ];
      mockPrisma.notification.findMany.mockResolvedValue(
        mockNotifications as any,
      );
      mockPrisma.notification.count.mockResolvedValue(2);

      const result = await service.findMy(userId, 1, 20);

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('meta');
      expect(result.meta.total).toBe(2);
    });

    it('should filter by read status when provided', async () => {
      const userId = 'user-uuid';
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(0);

      await service.findMy(userId, 1, 20, false);

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId, isRead: false }),
        }),
      );
    });
  });

  describe('getUnreadCount', () => {
    it('should return unread notification count', async () => {
      const userId = 'user-uuid';
      mockPrisma.notification.count.mockResolvedValue(5);

      const result = await service.getUnreadCount(userId);

      expect(result.unreadCount).toBe(5);
      expect(mockPrisma.notification.count).toHaveBeenCalledWith({
        where: { userId, isRead: false },
      });
    });
  });

  describe('markRead', () => {
    it('should mark notification as read', async () => {
      const userId = 'user-uuid';
      const notificationId = 'notification-uuid';
      const mockNotification = { id: notificationId, userId, isRead: false };

      mockPrisma.notification.findFirst.mockResolvedValue(
        mockNotification as any,
      );
      mockPrisma.notification.update.mockResolvedValue({
        ...mockNotification,
        isRead: true,
      } as any);

      const result = await service.markRead(userId, notificationId);

      expect(result.isRead).toBe(true);
    });

    it('should throw NotFoundException if notification not found', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      await expect(
        service.markRead('user-uuid', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return existing notification if already read', async () => {
      const userId = 'user-uuid';
      const notificationId = 'notification-uuid';
      const mockNotification = { id: notificationId, userId, isRead: true };

      mockPrisma.notification.findFirst.mockResolvedValue(
        mockNotification as any,
      );

      const result = await service.markRead(userId, notificationId);

      expect(result.isRead).toBe(true);
      expect(mockPrisma.notification.update).not.toHaveBeenCalled();
    });
  });

  describe('markAllRead', () => {
    it('should mark all notifications as read', async () => {
      const userId = 'user-uuid';
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 3 } as any);

      const result = await service.markAllRead(userId);

      expect(result.updated).toBe(3);
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId, isRead: false },
        data: { isRead: true, readAt: expect.any(Date) },
      });
    });
  });

  describe('deleteMyNotification', () => {
    it('should delete user notification', async () => {
      const userId = 'user-uuid';
      const notificationId = 'notification-uuid';
      const mockNotification = { id: notificationId, userId };

      mockPrisma.notification.findFirst.mockResolvedValue(
        mockNotification as any,
      );
      mockPrisma.notification.delete.mockResolvedValue(mockNotification as any);

      await service.deleteMyNotification(userId, notificationId);

      expect(mockPrisma.notification.delete).toHaveBeenCalledWith({
        where: { id: notificationId },
      });
    });

    it('should throw ForbiddenException if notification not found', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteMyNotification('user-uuid', 'nonexistent'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
