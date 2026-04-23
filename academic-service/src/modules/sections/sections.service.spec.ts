import { Test, TestingModule } from '@nestjs/testing';
import { SectionsService } from './sections.service';
import { PrismaService } from '../common/prisma/prisma.service';

describe('SectionsService', () => {
  let service: SectionsService;

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

      expect(result).toEqual(
        expect.objectContaining({
          id: '1',
          sectionNumber: '001',
          course: expect.objectContaining({
            code: 'CS101',
            nameEn: 'Introduction to Programming',
            nameVi: 'Nhập môn lập trình',
          }),
        }),
      );
    });

    it('should throw NotFoundException if section not found', async () => {
      mockPrisma.section.findUnique.mockResolvedValue(null);

      await expect(service.findOneSection('nonexistent')).rejects.toThrow();
    });
  });

  describe('findLecturerSchedule', () => {
    it('should map lecturer sections into the frontend schedule shape', async () => {
      mockPrisma.section.findMany.mockResolvedValue([
        {
          id: 'section-1',
          sectionNumber: '01',
          capacity: 40,
          enrolledCount: 12,
          status: 'OPEN',
          classroom: { building: 'Building A', roomNumber: 'Room 101' },
          course: {
            code: 'CS101',
            name: 'Introduction to Programming',
            credits: 3,
            department: { name: 'Computer Science' },
          },
          schedules: [
            {
              id: 'sched-2',
              dayOfWeek: 3,
              startTime: '09:00',
              endTime: '10:30',
              classroom: { building: 'Building A', roomNumber: 'Room 101' },
            },
            {
              id: 'sched-1',
              dayOfWeek: 1,
              startTime: '09:00',
              endTime: '10:30',
              classroom: { building: 'Building A', roomNumber: 'Room 101' },
            },
          ],
          _count: { enrollments: 15 },
        },
      ]);

      const result = await service.findLecturerSchedule('lecturer-1', 'sem-1');

      expect(mockPrisma.section.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { lecturerId: 'lecturer-1', semesterId: 'sem-1' },
        }),
      );
      expect(result).toEqual([
        expect.objectContaining({
          id: 'section-1',
          sectionId: 'section-1',
          courseCode: 'CS101',
          departmentName: 'Computer Science',
          enrolledCount: 15,
          schedules: [
            expect.objectContaining({ id: 'sched-1', dayOfWeek: 1 }),
            expect.objectContaining({ id: 'sched-2', dayOfWeek: 3 }),
          ],
        }),
      ]);
    });
  });

  describe('findLecturerGradingSections', () => {
    it('should summarize lecturer grading readiness', async () => {
      mockPrisma.section.findMany.mockResolvedValue([
        {
          id: 'section-1',
          sectionNumber: '01',
          course: {
            code: 'CS101',
            name: 'Introduction to Programming',
            credits: 3,
            department: { name: 'Computer Science' },
          },
          semester: { name: 'Spring 2025' },
          enrollments: [
            { id: 'en-1', finalGrade: 85, gradeStatus: 'PUBLISHED' },
            { id: 'en-2', finalGrade: 78, gradeStatus: 'DRAFT' },
            { id: 'en-3', finalGrade: null, gradeStatus: 'DRAFT' },
          ],
        },
      ]);

      const result = await service.findLecturerGradingSections('lecturer-1');

      expect(mockPrisma.section.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { lecturerId: 'lecturer-1' },
        }),
      );
      expect(result).toEqual([
        expect.objectContaining({
          id: 'section-1',
          sectionId: 'section-1',
          sectionNumber: '01',
          courseCode: 'CS101',
          courseName: 'Introduction to Programming',
          courseNameEn: 'Introduction to Programming',
          courseNameVi: 'Nhập môn lập trình',
          credits: 3,
          departmentName: 'Computer Science',
          departmentNameEn: 'Computer Science',
          departmentNameVi: undefined,
          semester: 'Spring 2025',
          semesterName: 'Spring 2025',
          semesterNameEn: 'Spring 2025',
          semesterNameVi: undefined,
          enrolledCount: 3,
          gradedCount: 2,
          publishedCount: 1,
          gradeStatus: 'PARTIAL',
          canPublish: false,
        }),
      ]);
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

      expect(result).toEqual(expect.objectContaining(mockSection));
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
