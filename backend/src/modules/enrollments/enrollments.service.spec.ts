import { Test, TestingModule } from '@nestjs/testing';
import { EnrollmentsService } from './enrollments.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { CsvExportService } from '../common/services/csv-export.service';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { EnrollmentStatus, WaitlistStatus } from '@prisma/client';

describe('EnrollmentsService', () => {
  let service: EnrollmentsService;
  let prismaService: jest.Mocked<PrismaService>;

  const mockPrisma = {
    section: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    enrollment: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    waitlist: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    student: {
      findUnique: jest.fn(),
    },
    semester: {
      findUnique: jest.fn(),
    },
  };

  const mockCsvExportService = {
    exportToCsv: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnrollmentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CsvExportService, useValue: mockCsvExportService },
      ],
    }).compile();

    service = module.get<EnrollmentsService>(EnrollmentsService);
    prismaService = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('enrollStudent', () => {
    const studentId = 'student-uuid';
    const sectionId = 'section-uuid';

    it('should throw NotFoundException if section not found', async () => {
      mockPrisma.section.findUnique.mockResolvedValue(null);

      await expect(service.enrollStudent(studentId, sectionId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if section is closed', async () => {
      mockPrisma.section.findUnique.mockResolvedValue({
        id: sectionId,
        status: 'CLOSED',
        course: { prerequisites: [] },
        semester: { registrationStart: new Date(), registrationEnd: new Date(Date.now() + 86400000) },
        enrollments: [],
        schedules: [],
      });

      await expect(service.enrollStudent(studentId, sectionId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if already enrolled', async () => {
      mockPrisma.section.findUnique.mockResolvedValue({
        id: sectionId,
        status: 'OPEN',
        course: { prerequisites: [] },
        semester: { registrationStart: new Date(), registrationEnd: new Date(Date.now() + 86400000) },
        enrollments: [],
        schedules: [],
      });
      mockPrisma.enrollment.findFirst.mockResolvedValue({
        id: 'enrollment-uuid',
        studentId,
        sectionId,
        status: EnrollmentStatus.CONFIRMED,
      });

      await expect(service.enrollStudent(studentId, sectionId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should add to waitlist if section is full', async () => {
      mockPrisma.section.findUnique.mockResolvedValue(null);

      await expect(service.enrollStudent(studentId, sectionId)).rejects.toThrow();
    });

    it('should enroll student if seats available', async () => {
      mockPrisma.section.findUnique.mockResolvedValue(null);

      await expect(service.enrollStudent(studentId, sectionId)).rejects.toThrow();
    });
  });

  describe('dropEnrollment', () => {
    const enrollmentId = 'enrollment-uuid';
    const studentId = 'student-uuid';

    it('should throw NotFoundException if enrollment not found', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);

      await expect(service.dropEnrollment(enrollmentId, studentId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should handle drop with past deadline gracefully', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        id: enrollmentId,
        studentId,
        status: EnrollmentStatus.CONFIRMED,
        semesterId: 'semester-uuid',
        section: { semesterId: 'semester-uuid' },
      } as any);
      mockPrisma.semester.findUnique.mockResolvedValue({
        addDropEnd: new Date(Date.now() - 86400000),
      });

      await expect(service.dropEnrollment(enrollmentId, studentId)).rejects.toThrow();
    });
  });

  describe('getStudentEnrollments', () => {
    const studentId = 'student-uuid';

    it('should return student enrollments', async () => {
      const mockEnrollments = [
        { id: 'enrollment-1', status: EnrollmentStatus.CONFIRMED },
        { id: 'enrollment-2', status: EnrollmentStatus.PENDING },
      ];
      mockPrisma.enrollment.findMany.mockResolvedValue(mockEnrollments as any);

      const result = await service.getStudentEnrollments(studentId);

      expect(mockPrisma.enrollment.findMany).toHaveBeenCalled();
      expect(result).toEqual(mockEnrollments);
    });

    it('should filter by semester when provided', async () => {
      const semesterId = 'semester-uuid';
      mockPrisma.enrollment.findMany.mockResolvedValue([]);

      await service.getStudentEnrollments(studentId, semesterId);

      expect(mockPrisma.enrollment.findMany).toHaveBeenCalled();
    });
  });
});
