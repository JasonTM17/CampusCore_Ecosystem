import { Test, TestingModule } from '@nestjs/testing';
import { AnnouncementsService } from './announcements.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('AnnouncementsService', () => {
  let service: AnnouncementsService;
  let prismaService: jest.Mocked<PrismaService>;

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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnouncementsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<AnnouncementsService>(AnnouncementsService);
    prismaService = module.get(PrismaService);
    jest.clearAllMocks();
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
        ...createData,
      } as any);

      const result = await service.create(createData as any);

      expect(result).toHaveProperty('id');
      expect(mockPrisma.announcement.create).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return paginated announcements', async () => {
      const mockAnnouncements = [
        { id: '1', title: 'Announcement 1' },
        { id: '2', title: 'Announcement 2' },
      ];
      mockPrisma.announcement.findMany.mockResolvedValue(mockAnnouncements as any);
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
      mockPrisma.announcement.findUnique.mockResolvedValue(mockAnnouncement as any);

      const result = await service.findOne(announcementId);

      expect(result).toEqual(mockAnnouncement);
    });

    it('should throw NotFoundException if announcement not found', async () => {
      mockPrisma.announcement.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update an announcement', async () => {
      const announcementId = 'announcement-uuid';
      const updateData = { title: 'Updated Title' };

      mockPrisma.announcement.findUnique.mockResolvedValue({ id: announcementId } as any);
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
      mockPrisma.announcement.findUnique.mockResolvedValue({ id: announcementId } as any);
      mockPrisma.announcement.delete.mockResolvedValue({ id: announcementId } as any);

      await service.remove(announcementId);

      expect(mockPrisma.announcement.delete).toHaveBeenCalledWith({
        where: { id: announcementId },
      });
    });

    it('should throw NotFoundException when deleting non-existent announcement', async () => {
      mockPrisma.announcement.findUnique.mockResolvedValue(null);

      await expect(service.remove('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
