import { Test, TestingModule } from '@nestjs/testing';
import { StudentsService } from './students.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AcademicContextService } from '../people-context/academic-context.service';
import { CoreUserContextService } from '../people-context/core-user-context.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';

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
  };

  const mockAcademicContext = {
    getCurriculum: jest.fn(),
    getStudentEnrollments: jest.fn(),
  };

  const mockCoreUserContext = {
    getUser: jest.fn(),
  };

  const mockRabbitMq = {
    publishMessage: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AcademicContextService, useValue: mockAcademicContext },
        { provide: CoreUserContextService, useValue: mockCoreUserContext },
        { provide: RabbitMQService, useValue: mockRabbitMq },
      ],
    }).compile();

    service = module.get<StudentsService>(StudentsService);
    jest.clearAllMocks();
  });

  it('creates a student with snapshots and publishes a shadow sync event', async () => {
    mockPrisma.student.findFirst.mockResolvedValue(null);
    mockCoreUserContext.getUser.mockResolvedValue({
      id: 'user-1',
      email: 'student1@campuscore.edu',
      firstName: 'Student',
      lastName: 'One',
    });
    mockAcademicContext.getCurriculum.mockResolvedValue({
      id: 'curr-1',
      code: 'CS-2026',
      name: 'Computer Science 2026',
      department: {
        id: 'dept-1',
        code: 'CS',
        name: 'Computer Science',
      },
    });
    mockPrisma.student.create.mockResolvedValue({
      id: 'student-1',
      userId: 'user-1',
      email: 'student1@campuscore.edu',
      firstName: 'Student',
      lastName: 'One',
      studentId: 'STU001',
      curriculumId: 'curr-1',
      curriculumCode: 'CS-2026',
      curriculumName: 'Computer Science 2026',
      departmentId: 'dept-1',
      departmentCode: 'CS',
      departmentName: 'Computer Science',
      year: 2,
      status: 'ACTIVE',
      admissionDate: new Date('2025-09-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const result = await service.create({
      userId: 'user-1',
      studentId: 'STU001',
      curriculumId: 'curr-1',
      year: 2,
      admissionDate: '2025-09-01',
    });

    expect(result.user.email).toBe('student1@campuscore.edu');
    expect(result.curriculum.name).toBe('Computer Science 2026');
    expect(mockRabbitMq.publishMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'student.upserted',
      }),
    );
  });

  it('delegates enrollment history to academic context', async () => {
    mockPrisma.student.findUnique.mockResolvedValue({
      id: 'student-1',
      userId: 'user-1',
      email: 'student1@campuscore.edu',
      firstName: 'Student',
      lastName: 'One',
      studentId: 'STU001',
      curriculumId: 'curr-1',
      curriculumCode: 'CS-2026',
      curriculumName: 'Computer Science 2026',
      departmentId: 'dept-1',
      departmentCode: 'CS',
      departmentName: 'Computer Science',
      year: 2,
      status: 'ACTIVE',
      admissionDate: new Date('2025-09-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    mockAcademicContext.getStudentEnrollments.mockResolvedValue([
      { id: 'enrollment-1' },
    ]);

    const result = await service.getEnrollmentHistory('student-1');

    expect(result).toEqual([{ id: 'enrollment-1' }]);
    expect(mockAcademicContext.getStudentEnrollments).toHaveBeenCalledWith(
      'student-1',
    );
  });
});
