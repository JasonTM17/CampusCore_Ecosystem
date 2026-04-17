import { Test, TestingModule } from '@nestjs/testing';
import { GradesService } from './grades.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('GradesService', () => {
  let service: GradesService;

  const mockPrisma = {
    gradeItem: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    studentGrade: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      createManyAndReturn: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    enrollment: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    section: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GradesService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<GradesService>(GradesService);
    jest.clearAllMocks();
  });

  describe('findAllGradeItems', () => {
    it('should return paginated grade items', async () => {
      const mockGradeItems = [
        { id: '1', name: 'Midterm', weight: 30 },
        { id: '2', name: 'Final', weight: 40 },
      ];
      mockPrisma.gradeItem.findMany.mockResolvedValue(mockGradeItems as any);
      mockPrisma.gradeItem.count.mockResolvedValue(2);

      const result = await service.findAllGradeItems(1, 20);

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('meta');
      expect(result.meta.total).toBe(2);
    });
  });

  describe('findGradeItemsBySection', () => {
    it('should return grade items for a section', async () => {
      const sectionId = 'section-uuid';
      const mockGradeItems = [{ id: '1', sectionId, name: 'Midterm' }];
      mockPrisma.gradeItem.findMany.mockResolvedValue(mockGradeItems as any);

      const result = await service.findGradeItemsBySection(sectionId);

      expect(mockPrisma.gradeItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sectionId },
        }),
      );
      expect(result).toEqual(mockGradeItems);
    });
  });

  describe('findOneGradeItem', () => {
    it('should return a grade item by id', async () => {
      const gradeItemId = 'grade-item-uuid';
      const mockGradeItem = { id: gradeItemId, name: 'Midterm' };
      mockPrisma.gradeItem.findUnique.mockResolvedValue(mockGradeItem as any);

      const result = await service.findOneGradeItem(gradeItemId);

      expect(result).toEqual(mockGradeItem);
    });

    it('should throw NotFoundException if grade item not found', async () => {
      mockPrisma.gradeItem.findUnique.mockResolvedValue(null);

      await expect(service.findOneGradeItem('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateGradeItem', () => {
    it('should update a grade item', async () => {
      const gradeItemId = 'grade-item-uuid';
      const updateData = { name: 'Updated Midterm', weight: 35 };
      const mockGradeItem = { id: gradeItemId, ...updateData };

      mockPrisma.gradeItem.findUnique.mockResolvedValue({
        id: gradeItemId,
      } as any);
      mockPrisma.gradeItem.update.mockResolvedValue(mockGradeItem as any);

      const result = await service.updateGradeItem(gradeItemId, updateData);

      expect(mockPrisma.gradeItem.update).toHaveBeenCalledWith({
        where: { id: gradeItemId },
        data: updateData,
        include: { section: true },
      });
      expect(result.name).toBe('Updated Midterm');
    });
  });

  describe('removeGradeItem', () => {
    it('should delete a grade item', async () => {
      const gradeItemId = 'grade-item-uuid';
      mockPrisma.gradeItem.findUnique.mockResolvedValue({
        id: gradeItemId,
      } as any);
      mockPrisma.gradeItem.delete.mockResolvedValue({ id: gradeItemId } as any);

      const result = await service.removeGradeItem(gradeItemId);

      expect(mockPrisma.gradeItem.delete).toHaveBeenCalledWith({
        where: { id: gradeItemId },
      });
      expect(result).toEqual({ message: 'Grade item deleted successfully' });
    });
  });

  describe('findStudentGradesBySection', () => {
    it('should return student grades for a section', async () => {
      const sectionId = 'section-uuid';
      const mockEnrollments = [
        {
          id: 'enrollment-1',
          student: { user: { firstName: 'John', lastName: 'Doe' } },
          section: { course: { code: 'CS101', name: 'Intro to CS' } },
          gradeItems: [],
        },
      ];
      mockPrisma.enrollment.findMany.mockResolvedValue(mockEnrollments as any);

      const result = await service.findStudentGradesBySection(sectionId);

      expect(mockPrisma.enrollment.findMany).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });
  });

  describe('findAllStudentGrades', () => {
    it('should return grades for a specific student', async () => {
      const mockStudentGrades = [
        { id: '1', enrollment: { section: { course: { code: 'CS101' } } } },
      ];
      mockPrisma.studentGrade.findMany.mockResolvedValue(
        mockStudentGrades as any,
      );
      mockPrisma.studentGrade.count.mockResolvedValue(1);

      const result = await service.findAllStudentGrades(1, 20);

      expect(result).toHaveProperty('data');
    });
  });
});
