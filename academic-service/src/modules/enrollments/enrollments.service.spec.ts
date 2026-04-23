import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EnrollmentStatus, WaitlistStatus } from '@prisma/client';
import { EnrollmentsService } from './enrollments.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { CsvExportService } from '../common/services/csv-export.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';

describe('EnrollmentsService', () => {
  let service: EnrollmentsService;

  const mockPrisma = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    section: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    enrollment: {
      count: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    semester: {
      findUnique: jest.fn(),
    },
    waitlist: {
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockCsvExportService = {
    generateCsv: jest.fn(),
  };

  const mockRabbitMQService = {
    publishMessage: jest.fn(),
  };

  beforeEach(async () => {
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrisma) => Promise<unknown>) =>
        callback(mockPrisma),
    );
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'section-uuid' }]);
    mockPrisma.$executeRaw.mockResolvedValue(1);
    mockPrisma.section.update.mockResolvedValue({});
    mockRabbitMQService.publishMessage.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnrollmentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CsvExportService, useValue: mockCsvExportService },
        { provide: RabbitMQService, useValue: mockRabbitMQService },
      ],
    }).compile();

    service = module.get<EnrollmentsService>(EnrollmentsService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrisma) => Promise<unknown>) =>
        callback(mockPrisma),
    );
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'section-uuid' }]);
    mockPrisma.$executeRaw.mockResolvedValue(1);
    mockPrisma.section.update.mockResolvedValue({});
    mockRabbitMQService.publishMessage.mockResolvedValue(true);
  });

  describe('enrollStudent', () => {
    const studentId = 'student-uuid';
    const sectionId = 'section-uuid';

    it('throws when the section cannot be found', async () => {
      mockPrisma.section.findUnique.mockResolvedValue(null);

      await expect(service.enrollStudent(studentId, sectionId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('adds an eligible student to the waitlist when the section is full', async () => {
      mockPrisma.section.findUnique.mockResolvedValue(
        buildSection({ id: sectionId, capacity: 1 }),
      );
      mockPrisma.enrollment.findFirst.mockResolvedValueOnce(null);
      mockPrisma.waitlist.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'waitlist-3', position: 3 });
      mockPrisma.enrollment.findMany.mockResolvedValue([]);
      mockPrisma.enrollment.count.mockResolvedValue(1);
      mockPrisma.waitlist.create.mockResolvedValue({
        id: 'waitlist-4',
        studentId,
        sectionId,
        position: 4,
        status: WaitlistStatus.ACTIVE,
        student: {
          userId: 'user-uuid',
          user: {
            id: 'user-uuid',
            email: 'student@example.edu',
            firstName: 'Ava',
            lastName: 'Nguyen',
          },
        },
        section: {
          sectionNumber: 'A1',
          course: {
            code: 'CS301',
            name: 'Distributed Systems',
            nameEn: 'Distributed Systems',
            nameVi: 'Hệ thống phân tán',
          },
          semester: {
            name: 'Spring 2025',
            nameEn: 'Spring 2025',
            nameVi: 'Học kỳ Xuân 2025',
          },
        },
      });

      const result = await service.enrollStudent(studentId, sectionId);

      expect(mockPrisma.waitlist.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            studentId,
            sectionId,
            position: 4,
            status: WaitlistStatus.ACTIVE,
          }),
        }),
      );
      expect(mockRabbitMQService.publishMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'notification.user.created',
          payload: expect.objectContaining({
            userId: 'user-uuid',
            notification: expect.objectContaining({
              type: 'INFO',
              link: '/dashboard/register',
            }),
            email: expect.objectContaining({
              to: 'student@example.edu',
              template: 'enrollment.waitlisted',
              courseNameVi: 'Hệ thống phân tán',
              semesterNameVi: 'Học kỳ Xuân 2025',
            }),
          }),
        }),
      );
      expect(result).toMatchObject({
        id: 'waitlist-4',
        status: WaitlistStatus.ACTIVE,
      });
    });

    it('creates the enrollment, syncs seats, and publishes notification event when capacity remains', async () => {
      mockPrisma.section.findUnique.mockResolvedValue(
        buildSection({ id: sectionId, capacity: 2 }),
      );
      mockPrisma.enrollment.findFirst.mockResolvedValueOnce(null);
      mockPrisma.waitlist.findFirst.mockResolvedValueOnce(null);
      mockPrisma.enrollment.findMany.mockResolvedValue([]);
      mockPrisma.enrollment.count.mockResolvedValue(1);
      mockPrisma.enrollment.create.mockResolvedValue({
        id: 'enrollment-uuid',
        studentId,
        sectionId,
        status: EnrollmentStatus.PENDING,
        student: {
          userId: 'user-uuid',
          user: {
            id: 'user-uuid',
            email: 'student@example.edu',
            firstName: 'Ava',
            lastName: 'Nguyen',
          },
        },
        section: {
          sectionNumber: 'A1',
          course: {
            code: 'CS301',
            name: 'Distributed Systems',
            nameEn: 'Distributed Systems',
            nameVi: 'Hệ thống phân tán',
          },
          semester: {
            name: 'Spring 2025',
            nameEn: 'Spring 2025',
            nameVi: 'Học kỳ Xuân 2025',
          },
        },
      });

      const result = await service.enrollStudent(studentId, sectionId);

      expect(mockPrisma.enrollment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            studentId,
            sectionId,
            status: EnrollmentStatus.PENDING,
          }),
        }),
      );
      expect(mockPrisma.section.update).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { id: sectionId },
          data: { enrolledCount: 2 },
        }),
      );
      expect(mockRabbitMQService.publishMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'notification.user.created',
          source: 'campuscore-academic-service',
          payload: expect.objectContaining({
            userId: 'user-uuid',
            notification: expect.objectContaining({
              type: 'SUCCESS',
              link: '/dashboard/enrollments',
            }),
            email: expect.objectContaining({
              to: 'student@example.edu',
              template: 'enrollment.confirmed',
              studentName: 'Ava Nguyen',
              courseCode: 'CS301',
              courseName: 'Distributed Systems',
              courseNameVi: 'Hệ thống phân tán',
              sectionNumber: 'A1',
              semesterNameVi: 'Học kỳ Xuân 2025',
            }),
          }),
        }),
      );
      expect(result).toMatchObject({
        id: 'enrollment-uuid',
        status: EnrollmentStatus.PENDING,
      });
    });
  });

  describe('dropEnrollment', () => {
    it('deletes the enrollment and promotes the first active waitlist entry atomically', async () => {
      const enrollmentId = 'enrollment-uuid';
      const studentId = 'student-uuid';
      const sectionId = 'section-uuid';

      mockPrisma.enrollment.findUnique
        .mockResolvedValueOnce({ sectionId })
        .mockResolvedValueOnce({
          id: enrollmentId,
          studentId,
          sectionId,
          semesterId: 'semester-uuid',
          status: EnrollmentStatus.CONFIRMED,
          droppedAt: null,
          student: { user: null },
          section: { course: {}, lecturer: null },
          semester: {},
        });
      mockPrisma.semester.findUnique.mockResolvedValue({
        addDropEnd: new Date(Date.now() + 60_000),
      });
      mockPrisma.section.findUnique.mockResolvedValue(
        buildSection({ id: sectionId, capacity: 1 }),
      );
      mockPrisma.enrollment.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);
      mockPrisma.waitlist.findMany.mockResolvedValue([
        {
          id: 'waitlist-1',
          studentId: 'waitlisted-student',
          sectionId,
          position: 1,
          status: WaitlistStatus.ACTIVE,
          addedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);
      mockPrisma.enrollment.findFirst.mockResolvedValue(null);
      mockPrisma.enrollment.findMany.mockResolvedValue([]);
      mockPrisma.enrollment.create.mockResolvedValue({
        id: 'promoted-enrollment',
      });
      mockPrisma.waitlist.update.mockResolvedValue({
        id: 'waitlist-1',
        status: WaitlistStatus.CONVERTED,
      });

      const result = await service.dropEnrollment(enrollmentId, studentId);

      expect(mockPrisma.enrollment.delete).toHaveBeenCalledWith({
        where: { id: enrollmentId },
      });
      expect(mockPrisma.enrollment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            studentId: 'waitlisted-student',
            sectionId,
            status: EnrollmentStatus.PENDING,
          }),
        }),
      );
      expect(mockPrisma.waitlist.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'waitlist-1' },
          data: expect.objectContaining({
            status: WaitlistStatus.CONVERTED,
          }),
        }),
      );
      expect(result).toEqual({ message: 'Enrollment dropped successfully' });
    });
  });

  describe('getStudentEnrollments', () => {
    it('returns student enrollments and forwards the semester filter', async () => {
      mockPrisma.enrollment.findMany.mockResolvedValue([
        { id: 'enrollment-1', status: EnrollmentStatus.CONFIRMED },
      ]);

      const result = await service.getStudentEnrollments(
        'student-uuid',
        'semester-uuid',
      );

      expect(mockPrisma.enrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            studentId: 'student-uuid',
            semesterId: 'semester-uuid',
          }),
        }),
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('removeWaitlistEntry', () => {
    it('blocks students from removing another student waitlist entry', async () => {
      mockPrisma.waitlist.findUnique.mockResolvedValue({
        id: 'waitlist-1',
        studentId: 'student-owner',
        sectionId: 'section-uuid',
        status: WaitlistStatus.ACTIVE,
      });

      await expect(
        service.removeWaitlistEntry('waitlist-1', 'different-student'),
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.waitlist.delete).not.toHaveBeenCalled();
    });

    it('allows the owning student to remove an active waitlist entry and resequence the queue', async () => {
      mockPrisma.waitlist.findUnique
        .mockResolvedValueOnce({
          id: 'waitlist-1',
          studentId: 'student-owner',
          sectionId: 'section-uuid',
          status: WaitlistStatus.ACTIVE,
        })
        .mockResolvedValueOnce({ sectionId: 'section-uuid' })
        .mockResolvedValueOnce({
          id: 'waitlist-1',
          studentId: 'student-owner',
          sectionId: 'section-uuid',
          status: WaitlistStatus.ACTIVE,
        });

      const result = await service.removeWaitlistEntry(
        'waitlist-1',
        'student-owner',
      );

      expect(mockPrisma.waitlist.delete).toHaveBeenCalledWith({
        where: { id: 'waitlist-1' },
      });
      expect(result).toEqual({
        message: 'Waitlist entry removed successfully',
      });
    });
  });
});

function buildSection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'section-uuid',
    sectionNumber: 'A1',
    semesterId: 'semester-uuid',
    capacity: 1,
    status: 'OPEN',
    maxCredits: 21,
    course: {
      id: 'course-uuid',
      code: 'CS301',
      name: 'Distributed Systems',
      credits: 3,
      prerequisites: [],
    },
    semester: {
      registrationStart: new Date(Date.now() - 60_000),
      registrationEnd: new Date(Date.now() + 60_000),
      addDropStart: new Date(Date.now() - 60_000),
      addDropEnd: new Date(Date.now() + 60_000),
    },
    schedules: [],
    ...overrides,
  };
}
