import { Test, TestingModule } from '@nestjs/testing';
import { StudentsService } from './students.service';
import { PrismaService } from '../common/prisma/prisma.service';

describe('StudentsService', () => {
  let service: StudentsService;

  const mockPrisma = {
    student: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudentsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<StudentsService>(StudentsService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated students with metadata', async () => {
      const mockStudents = [
        {
          id: '1',
          studentId: 'STU001',
          user: { firstName: 'John', lastName: 'Doe' },
        },
      ];

      mockPrisma.student.findMany.mockResolvedValue(mockStudents);
      mockPrisma.student.count.mockResolvedValue(1);

      const result = await service.findAll(1, 20);

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('meta');
    });

    it('should call prisma with correct parameters', async () => {
      mockPrisma.student.findMany.mockResolvedValue([]);
      mockPrisma.student.count.mockResolvedValue(0);

      await service.findAll(1, 20, 'ACTIVE');

      expect(mockPrisma.student.findMany).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a student by id', async () => {
      const mockStudent = {
        id: '1',
        studentId: 'STU001',
        user: { firstName: 'John', lastName: 'Doe' },
      };

      mockPrisma.student.findUnique.mockResolvedValue(mockStudent);

      const result = await service.findOne('1');

      expect(result).toEqual(mockStudent);
    });

    it('should throw NotFoundException if student not found', async () => {
      mockPrisma.student.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow();
    });
  });

  describe('create', () => {
    it('should create a new student', async () => {
      mockPrisma.student.findFirst.mockResolvedValue(null);
      mockPrisma.student.create.mockResolvedValue({
        id: '1',
        studentId: 'STU001',
        userId: 'user-1',
      });

      const result = await service.create({
        userId: 'user-1',
        studentId: 'STU001',
        curriculumId: 'curriculum-1',
        year: 1,
        admissionDate: new Date(),
      } as any);

      expect(result).toHaveProperty('id');
    });
  });

  describe('update', () => {
    it('should update a student', async () => {
      mockPrisma.student.findUnique.mockResolvedValue({
        id: '1',
        studentId: 'STU001',
        year: 2,
      });
      mockPrisma.student.update.mockResolvedValue({
        id: '1',
        studentId: 'STU001',
        year: 3,
      });

      const result = await service.update('1', { year: 3 } as any);

      expect(result.year).toBe(3);
    });

    it('should throw NotFoundException if student not found', async () => {
      mockPrisma.student.findUnique.mockResolvedValue(null);

      await expect(
        service.update('nonexistent', { year: 3 } as any),
      ).rejects.toThrow();
    });
  });
});
