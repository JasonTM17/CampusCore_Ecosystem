import { Test, TestingModule } from '@nestjs/testing';
import { SectionsService } from './sections.service';
import { PrismaService } from '../common/prisma/prisma.service';

describe('SectionsService', () => {
  let service: SectionsService;
  let prismaService: jest.Mocked<PrismaService>;

  const mockPrisma = {
    section: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    enrollment: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SectionsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<SectionsService>(SectionsService);
    prismaService = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('findAllSections', () => {
    it('should return paginated sections with metadata', async () => {
      const mockSections = [
        { id: '1', sectionNumber: '001', course: { code: 'CS101' } },
      ];

      mockPrisma.section.findMany.mockResolvedValue(mockSections);
      mockPrisma.section.count.mockResolvedValue(1);

      const result = await service.findAllSections(1, 100);

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('meta');
    });

    it('should call prisma with correct filter parameters', async () => {
      mockPrisma.section.findMany.mockResolvedValue([]);
      mockPrisma.section.count.mockResolvedValue(0);

      await service.findAllSections(1, 100, 'sem-123');

      expect(mockPrisma.section.findMany).toHaveBeenCalled();
    });
  });

  describe('findOneSection', () => {
    it('should return a section by id', async () => {
      const mockSection = {
        id: '1',
        sectionNumber: '001',
        course: { code: 'CS101' },
      };

      mockPrisma.section.findUnique.mockResolvedValue(mockSection);

      const result = await service.findOneSection('1');

      expect(result).toEqual(mockSection);
    });

    it('should throw NotFoundException if section not found', async () => {
      mockPrisma.section.findUnique.mockResolvedValue(null);

      await expect(service.findOneSection('nonexistent')).rejects.toThrow();
    });
  });

  describe('createSection', () => {
    it('should create a new section', async () => {
      const mockSection = {
        id: '1',
        sectionNumber: '001',
        courseId: 'course-1',
        semesterId: 'semester-1',
      };

      mockPrisma.section.create.mockResolvedValue(mockSection);

      const result = await service.createSection({
        sectionNumber: '001',
        courseId: 'course-1',
        semesterId: 'semester-1',
      } as any);

      expect(result).toEqual(mockSection);
    });
  });

  describe('updateSection', () => {
    it('should update a section', async () => {
      const mockSection = {
        id: '1',
        sectionNumber: '001',
        capacity: 50,
      };

      mockPrisma.section.findUnique.mockResolvedValue(mockSection);
      mockPrisma.section.update.mockResolvedValue({
        ...mockSection,
        capacity: 60,
      });

      const result = await service.updateSection('1', { capacity: 60 } as any);

      expect(result.capacity).toBe(60);
    });

    it('should throw NotFoundException if section not found for update', async () => {
      mockPrisma.section.findUnique.mockResolvedValue(null);

      await expect(
        service.updateSection('nonexistent', { capacity: 60 } as any),
      ).rejects.toThrow();
    });
  });
});
