import { Test, TestingModule } from '@nestjs/testing';
import { LecturersService } from './lecturers.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AcademicContextService } from '../people-context/academic-context.service';
import { AuthUserContextService } from '../people-context/auth-user-context.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';

describe('LecturersService', () => {
  let service: LecturersService;

  const mockPrisma = {
    lecturer: {
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
    getDepartment: jest.fn(),
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
        LecturersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AcademicContextService, useValue: mockAcademicContext },
        { provide: AuthUserContextService, useValue: mockCoreUserContext },
        { provide: RabbitMQService, useValue: mockRabbitMq },
      ],
    }).compile();

    service = module.get<LecturersService>(LecturersService);
    jest.clearAllMocks();
  });

  it('creates a lecturer with snapshots and publishes a shadow sync event', async () => {
    mockPrisma.lecturer.findFirst.mockResolvedValue(null);
    mockCoreUserContext.getUser.mockResolvedValue({
      id: 'user-lect-1',
      email: 'john.doe@campuscore.edu',
      firstName: 'John',
      lastName: 'Doe',
      phone: '0123456789',
    });
    mockAcademicContext.getDepartment.mockResolvedValue({
      id: 'dept-1',
      code: 'CS',
      name: 'Computer Science',
    });
    mockPrisma.lecturer.create.mockResolvedValue({
      id: 'lecturer-1',
      userId: 'user-lect-1',
      email: 'john.doe@campuscore.edu',
      firstName: 'John',
      lastName: 'Doe',
      departmentId: 'dept-1',
      departmentCode: 'CS',
      departmentName: 'Computer Science',
      employeeId: 'EMP001',
      title: 'Dr.',
      specialization: 'Distributed Systems',
      office: 'B-201',
      phone: '0123456789',
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const result = await service.create({
      userId: 'user-lect-1',
      departmentId: 'dept-1',
      employeeId: 'EMP001',
      title: 'Dr.',
      specialization: 'Distributed Systems',
      office: 'B-201',
    });

    expect(result.department.name).toBe('Computer Science');
    expect(result.user.email).toBe('john.doe@campuscore.edu');
    expect(mockRabbitMq.publishMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'lecturer.upserted',
      }),
    );
  });
});
