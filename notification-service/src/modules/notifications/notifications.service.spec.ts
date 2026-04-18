import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../common/prisma/prisma.service';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const mockPrisma = {
    notification: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
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

  it('returns paginated notifications for a user', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([{ id: 'n1' }] as never);
    mockPrisma.notification.count.mockResolvedValue(1 as never);

    const result = await service.findMy('user-1', 1, 20);

    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
  });

  it('marks a notification as read', async () => {
    mockPrisma.notification.findFirst.mockResolvedValue({
      id: 'n1',
      userId: 'user-1',
      isRead: false,
    } as never);
    mockPrisma.notification.update.mockResolvedValue({
      id: 'n1',
      isRead: true,
    } as never);

    const result = await service.markRead('user-1', 'n1');
    expect(result.isRead).toBe(true);
  });

  it('throws when notification does not belong to the user', async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(null as never);

    await expect(service.markRead('user-1', 'missing')).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      service.deleteMyNotification('user-1', 'missing'),
    ).rejects.toThrow(ForbiddenException);
  });
});
