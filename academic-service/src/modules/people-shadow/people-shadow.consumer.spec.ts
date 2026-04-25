import { Test, TestingModule } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { PEOPLE_SHADOW_ACADEMIC_QUEUE } from '../rabbitmq/rabbitmq.events';
import { PeopleShadowConsumer } from './people-shadow.consumer';

describe('PeopleShadowConsumer', () => {
  let consumeCallback: (message: unknown) => Promise<void> | void;

  const mockRabbitMQService = {
    consumeMessages: jest.fn((queue, callback) => {
      consumeCallback = callback;
    }),
  };

  const mockPrisma = {
    curriculum: {
      findUnique: jest.fn(),
    },
    department: {
      findUnique: jest.fn(),
    },
    user: {
      upsert: jest.fn(),
    },
    student: {
      deleteMany: jest.fn(),
      upsert: jest.fn(),
    },
    lecturer: {
      deleteMany: jest.fn(),
      upsert: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    consumeCallback = undefined as unknown as typeof consumeCallback;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PeopleShadowConsumer,
        { provide: RabbitMQService, useValue: mockRabbitMQService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    await module.get(PeopleShadowConsumer).onModuleInit();
  });

  it('subscribes to the academic people-shadow queue', () => {
    expect(mockRabbitMQService.consumeMessages).toHaveBeenCalledWith(
      PEOPLE_SHADOW_ACADEMIC_QUEUE,
      expect.any(Function),
    );
  });

  it('upserts a user and student shadow for student events', async () => {
    mockPrisma.curriculum.findUnique.mockResolvedValue({ id: 'curriculum-1' });

    await consumeCallback({
      type: 'student.upserted',
      payload: {
        id: 'student-1',
        userId: 'user-1',
        email: 'student@example.edu',
        firstName: 'Student',
        lastName: 'One',
        studentId: 'STU-001',
        curriculumId: 'curriculum-1',
        year: 1,
        status: 'ACTIVE',
        admissionDate: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(mockPrisma.user.upsert).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      update: {
        email: 'student@example.edu',
        firstName: 'Student',
        lastName: 'One',
        status: UserStatus.ACTIVE,
      },
      create: {
        id: 'user-1',
        email: 'student@example.edu',
        firstName: 'Student',
        lastName: 'One',
        status: UserStatus.ACTIVE,
      },
    });
    expect(mockPrisma.student.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'student-1' },
      }),
    );
  });

  it('skips stale student events when the curriculum is absent', async () => {
    mockPrisma.curriculum.findUnique.mockResolvedValue(null);

    await consumeCallback({
      type: 'student.upserted',
      payload: {
        id: 'student-1',
        userId: 'user-1',
        email: 'student@example.edu',
        firstName: 'Student',
        lastName: 'One',
        studentId: 'STU-001',
        curriculumId: 'missing-curriculum',
        year: 1,
        status: 'ACTIVE',
        admissionDate: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.student.upsert).not.toHaveBeenCalled();
  });
});
