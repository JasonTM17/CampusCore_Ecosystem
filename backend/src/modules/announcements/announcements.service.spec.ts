import { Test, TestingModule } from '@nestjs/testing';
import { AnnouncementsService } from './announcements.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import {
  NOTIFICATION_EVENTS_QUEUE,
  NOTIFICATION_EVENT_TYPES,
} from '../rabbitmq/notification-events';

describe('AnnouncementsService', () => {
  let service: AnnouncementsService;

  const mockPrisma = {
    announcement: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
  };
  const mockRabbitMQService = {
    publishMessage: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnouncementsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: RabbitMQService,
          useValue: mockRabbitMQService,
        },
      ],
    }).compile();

    service = module.get<AnnouncementsService>(AnnouncementsService);
    jest.clearAllMocks();
    mockRabbitMQService.publishMessage.mockResolvedValue(true);
  });

  describe('create', () => {
    it('should create an announcement', async () => {
      const createData = {
        title: 'Test Announcement',
        content: 'Test content',
        targetRoles: ['STUDENT'],
        isGlobal: false,
      };

      mockPrisma.announcement.create.mockResolvedValue({
        id: 'announcement-uuid',
        createdAt: new Date('2026-04-18T10:00:00.000Z'),
        updatedAt: new Date('2026-04-18T10:00:00.000Z'),
        ...createData,
      } as any);

      const result = await service.create(createData as any);

      expect(result).toHaveProperty('id');
      expect(mockPrisma.announcement.create).toHaveBeenCalled();
      expect(mockRabbitMQService.publishMessage).toHaveBeenCalledWith(
        NOTIFICATION_EVENTS_QUEUE,
        expect.objectContaining({
          type: NOTIFICATION_EVENT_TYPES.ANNOUNCEMENT_CREATED,
          source: 'campuscore-core-api',
          payload: expect.objectContaining({
            announcement: expect.objectContaining({
              id: 'announcement-uuid',
              title: 'Test Announcement',
            }),
          }),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated announcements', async () => {
      const mockAnnouncements = [
        { id: '1', title: 'Announcement 1' },
        { id: '2', title: 'Announcement 2' },
      ];
      mockPrisma.announcement.findMany.mockResolvedValue(
        mockAnnouncements as any,
      );
      mockPrisma.announcement.count.mockResolvedValue(2);

      const result = await service.findAll(1, 20);

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('meta');
      expect(result.meta.total).toBe(2);
    });

    it('should filter by semester when provided', async () => {
      mockPrisma.announcement.findMany.mockResolvedValue([]);
      mockPrisma.announcement.count.mockResolvedValue(0);

      await service.findAll(1, 20, { semesterId: 'semester-uuid' });

      expect(mockPrisma.announcement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ semesterId: 'semester-uuid' }),
        }),
      );
    });

    it('should filter by priority when provided', async () => {
      mockPrisma.announcement.findMany.mockResolvedValue([]);
      mockPrisma.announcement.count.mockResolvedValue(0);

      await service.findAll(1, 20, { priority: 'HIGH' });

      expect(mockPrisma.announcement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ priority: 'HIGH' }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return an announcement by id', async () => {
      const announcementId = 'announcement-uuid';
      const mockAnnouncement = { id: announcementId, title: 'Test' };
      mockPrisma.announcement.findUnique.mockResolvedValue(
        mockAnnouncement as any,
      );

      const result = await service.findOne(announcementId);

      expect(result).toEqual(mockAnnouncement);
    });

    it('should throw NotFoundException if announcement not found', async () => {
      mockPrisma.announcement.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update an announcement', async () => {
      const announcementId = 'announcement-uuid';
      const updateData = { title: 'Updated Title' };

      mockPrisma.announcement.findUnique.mockResolvedValue({
        id: announcementId,
      } as any);
      mockPrisma.announcement.update.mockResolvedValue({
        id: announcementId,
        ...updateData,
      } as any);

      const result = await service.update(announcementId, updateData as any);

      expect(result.title).toBe('Updated Title');
    });
  });

  describe('remove', () => {
    it('should delete an announcement', async () => {
      const announcementId = 'announcement-uuid';
      mockPrisma.announcement.findUnique.mockResolvedValue({
        id: announcementId,
      } as any);
      mockPrisma.announcement.delete.mockResolvedValue({
        id: announcementId,
      } as any);

      await service.remove(announcementId);

      expect(mockPrisma.announcement.delete).toHaveBeenCalledWith({
        where: { id: announcementId },
      });
    });

    it('should throw NotFoundException when deleting non-existent announcement', async () => {
      mockPrisma.announcement.findUnique.mockResolvedValue(null);

      await expect(service.remove('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
