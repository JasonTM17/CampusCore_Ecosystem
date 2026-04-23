import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EnrollmentStatus, Prisma, WaitlistStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { CsvExportService } from '../common/services/csv-export.service';
import { hydrateLocalizedCatalogRecord } from '../common/catalog-localization';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import {
  ACADEMIC_NOTIFICATION_EVENT_TYPES,
  AcademicEventEnvelope,
} from '../rabbitmq/rabbitmq.events';

const SEAT_CONSUMING_STATUSES: EnrollmentStatus[] = [
  EnrollmentStatus.PENDING,
  EnrollmentStatus.CONFIRMED,
  EnrollmentStatus.COMPLETED,
];
const DROPPABLE_STATUSES: EnrollmentStatus[] = [
  EnrollmentStatus.PENDING,
  EnrollmentStatus.CONFIRMED,
];
const TRANSACTION_RETRY_LIMIT = 3;

type EnrollmentTransaction = Prisma.TransactionClient;
type SectionEnrollmentContext = Prisma.SectionGetPayload<{
  include: {
    course: {
      include: {
        prerequisites: {
          include: {
            prerequisite: true;
          };
        };
      };
    };
    semester: true;
    schedules: {
      include: {
        classroom: true;
      };
    };
  };
}>;
type StudentSemesterEnrollment = Prisma.EnrollmentGetPayload<{
  include: {
    section: {
      include: {
        schedules: true;
        course: true;
      };
    };
  };
}>;
type TranscriptRecord = Awaited<
  ReturnType<EnrollmentsService['getStudentGrades']>
>[number];
type TranscriptSemesterAccumulator = {
  semesterId: string;
  semesterName: string;
  semesterNameEn?: string | null;
  semesterNameVi?: string | null;
  records: TranscriptRecord[];
  gpa: number;
  creditsEarned: number;
  creditsAttempted: number;
  gradePoints: number;
};
type EnrollmentNotificationRecord = {
  id: string;
  student: {
    userId?: string | null;
    user?: {
      id?: string | null;
      email?: string | null;
      firstName?: string | null;
      lastName?: string | null;
    } | null;
  };
  section?: {
    sectionNumber: string;
    course?: {
      code?: string | null;
      name?: string | null;
      nameEn?: string | null;
      nameVi?: string | null;
    } | null;
    semester?: {
      name?: string | null;
      nameEn?: string | null;
      nameVi?: string | null;
    } | null;
  } | null;
  semester?: {
    name?: string | null;
    nameEn?: string | null;
    nameVi?: string | null;
  } | null;
};
type EnrollmentNotificationTemplate =
  | 'enrollment.confirmed'
  | 'enrollment.waitlisted'
  | 'enrollment.promoted'
  | 'enrollment.dropped';

@Injectable()
export class EnrollmentsService {
  private readonly logger = new Logger(EnrollmentsService.name);

  constructor(
    private prisma: PrismaService,
    private csvExportService: CsvExportService,
    private rabbitMQService: RabbitMQService,
  ) {}

  async enrollStudent(studentId: string, sectionId: string) {
    const result = await this.withSerializableTransaction(async (tx) => {
      const section = await this.getSectionEnrollmentContext(tx, sectionId);

      this.assertSectionOpenForEnrollment(section);
      await this.assertStudentNotAlreadyQueued(tx, studentId, sectionId);
      await this.assertStudentEligibleForSection(tx, studentId, section);

      const currentEnrollmentCount = await this.syncSectionEnrolledCount(
        tx,
        section.id,
      );

      if (currentEnrollmentCount >= section.capacity) {
        const waitlistEntry = await this.addStudentToWaitlist(
          tx,
          studentId,
          section.id,
        );

        return { kind: 'waitlist' as const, record: waitlistEntry };
      }

      const enrollment = await tx.enrollment.create({
        data: {
          studentId,
          sectionId: section.id,
          semesterId: section.semesterId,
          status: EnrollmentStatus.PENDING,
        },
        include: {
          student: { include: { user: true } },
          section: { include: { course: true, semester: true } },
        },
      });

      await tx.section.update({
        where: { id: section.id },
        data: { enrolledCount: currentEnrollmentCount + 1 },
      });

      return { kind: 'enrollment' as const, record: enrollment };
    });

    if (result.kind === 'enrollment') {
      this.publishEnrollmentNotification(result.record, 'enrollment.confirmed');
    } else {
      this.publishEnrollmentNotification(
        result.record,
        'enrollment.waitlisted',
      );
    }

    return result.record;
  }

  async dropEnrollment(enrollmentId: string, studentId: string) {
    const result = await this.withSerializableTransaction(async (tx) => {
      const enrollment = await this.getLockedEnrollmentForMutation(
        tx,
        enrollmentId,
      );

      if (enrollment.studentId !== studentId) {
        throw new ForbiddenException('Not authorized to drop this enrollment');
      }

      if (!DROPPABLE_STATUSES.includes(enrollment.status)) {
        throw new BadRequestException('Only active enrollments can be dropped');
      }

      const semester = await tx.semester.findUnique({
        where: { id: enrollment.semesterId },
      });

      const now = new Date();
      if (semester?.addDropEnd && now > semester.addDropEnd) {
        throw new ForbiddenException('Add/drop period has ended');
      }

      await tx.enrollment.delete({ where: { id: enrollment.id } });
      const promotedEnrollments = await this.handleSeatAvailability(
        tx,
        enrollment.sectionId,
      );

      return { droppedEnrollment: enrollment, promotedEnrollments };
    });

    this.publishEnrollmentNotification(
      result.droppedEnrollment,
      'enrollment.dropped',
    );
    for (const promotedEnrollment of result.promotedEnrollments) {
      this.publishEnrollmentNotification(
        promotedEnrollment,
        'enrollment.promoted',
      );
    }

    return { message: 'Enrollment dropped successfully' };
  }

  async promoteWaitlistEntry(waitlistEntryId: string) {
    const promotedEnrollment = await this.withSerializableTransaction(
      async (tx) => {
        const entry = await this.getLockedWaitlistEntry(tx, waitlistEntryId);

        if (entry.status !== WaitlistStatus.ACTIVE) {
          throw new BadRequestException('Waitlist entry is not active');
        }

        const section = await this.getSectionEnrollmentContext(
          tx,
          entry.sectionId,
        );
        this.assertSectionOpenForEnrollment(section);

        const currentEnrollmentCount = await this.syncSectionEnrolledCount(
          tx,
          section.id,
        );

        if (currentEnrollmentCount >= section.capacity) {
          throw new BadRequestException('No seats available for promotion');
        }

        const existingEnrollment = await tx.enrollment.findFirst({
          where: { studentId: entry.studentId, sectionId: entry.sectionId },
        });

        if (existingEnrollment) {
          await tx.waitlist.update({
            where: { id: entry.id },
            data: { status: WaitlistStatus.CANCELLED },
          });
          await this.resequenceWaitlist(tx, entry.sectionId);
          throw new BadRequestException(
            'Student is already enrolled in this section',
          );
        }

        await this.assertStudentEligibleForSection(
          tx,
          entry.studentId,
          section,
        );

        const enrollment = await tx.enrollment.create({
          data: {
            studentId: entry.studentId,
            sectionId: entry.sectionId,
            semesterId: section.semesterId,
            status: EnrollmentStatus.PENDING,
          },
          include: {
            student: { include: { user: true } },
            section: { include: { course: true, semester: true } },
          },
        });

        await tx.waitlist.update({
          where: { id: entry.id },
          data: {
            status: WaitlistStatus.CONVERTED,
            convertedAt: new Date(),
          },
        });

        await this.syncSectionEnrolledCount(tx, section.id);
        await this.resequenceWaitlist(tx, section.id);

        return enrollment;
      },
    );

    this.publishEnrollmentNotification(
      promotedEnrollment,
      'enrollment.promoted',
    );

    return { message: 'Student promoted from waitlist' };
  }

  async removeWaitlistEntry(waitlistEntryId: string, actorStudentId?: string) {
    await this.withSerializableTransaction(async (tx) => {
      const entry = await tx.waitlist.findUnique({
        where: { id: waitlistEntryId },
      });

      if (!entry) {
        throw new NotFoundException('Waitlist entry not found');
      }

      if (actorStudentId && entry.studentId !== actorStudentId) {
        throw new ForbiddenException(
          'Not authorized to remove this waitlist entry',
        );
      }

      if (entry.status === WaitlistStatus.ACTIVE) {
        await this.lockSection(tx, entry.sectionId);
      }

      await tx.waitlist.delete({ where: { id: waitlistEntryId } });

      if (entry.status === WaitlistStatus.ACTIVE) {
        await this.resequenceWaitlist(tx, entry.sectionId);
      }
    });

    return { message: 'Waitlist entry removed successfully' };
  }

  async getStudentEnrollments(studentId: string, semesterId?: string) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        studentId,
        ...(semesterId ? { semesterId } : {}),
      },
      include: {
        section: {
          include: {
            course: true,
            lecturer: { include: { user: true } },
            schedules: { include: { classroom: true } },
          },
        },
      },
      orderBy: { enrolledAt: 'desc' },
    });

    return enrollments.map((enrollment) => this.hydrateEnrollment(enrollment));
  }

  async findAll(
    page = 1,
    limit = 20,
    status?: string,
    semesterId?: string,
    studentId?: string,
    courseId?: string,
    sectionId?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};

    if (status) {
      where.status = status;
    }
    if (semesterId) {
      where.semesterId = semesterId;
    }
    if (studentId) {
      where.studentId = studentId;
    }
    if (sectionId) {
      where.sectionId = sectionId;
    }
    if (courseId) {
      where.section = { courseId };
    }

    const [enrollments, total] = await Promise.all([
      this.prisma.enrollment.findMany({
        skip,
        take: limit,
        where,
        include: {
          student: { include: { user: true } },
          section: {
            include: {
              course: true,
              lecturer: { include: { user: true } },
            },
          },
          semester: true,
        },
        orderBy: { enrolledAt: 'desc' },
      }),
      this.prisma.enrollment.count({ where }),
    ]);

    return {
      data: enrollments.map((enrollment) => this.hydrateEnrollment(enrollment)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async exportAll(
    status?: string,
    semesterId?: string,
    studentId?: string,
    courseId?: string,
    sectionId?: string,
  ) {
    const where: Record<string, unknown> = {};

    if (status) {
      where.status = status;
    }
    if (semesterId) {
      where.semesterId = semesterId;
    }
    if (studentId) {
      where.studentId = studentId;
    }
    if (sectionId) {
      where.sectionId = sectionId;
    }
    if (courseId) {
      where.section = { courseId };
    }

    const enrollments = await this.prisma.enrollment.findMany({
      where,
      include: {
        student: { include: { user: true } },
        section: {
          include: {
            course: true,
            lecturer: { include: { user: true } },
          },
        },
        semester: true,
      },
      orderBy: { enrolledAt: 'desc' },
    });

    const exportData = enrollments.map((e) => ({
      enrollmentId: e.id,
      studentId: e.studentId,
      studentName: e.student.user
        ? `${e.student.user.firstName} ${e.student.user.lastName}`
        : '',
      studentEmail: e.student.user?.email || '',
      studentNumber: e.student.studentId || '',
      sectionId: e.sectionId,
      sectionNumber: e.section.sectionNumber,
      courseCode: e.section.course.code,
      courseName: e.section.course.name,
      credits: e.section.course.credits,
      lecturerName: e.section.lecturer?.user
        ? `${e.section.lecturer.user.firstName} ${e.section.lecturer.user.lastName}`
        : '',
      semesterName: e.semester.name,
      status: e.status,
      finalGrade: e.finalGrade ? Number(e.finalGrade) : null,
      letterGrade: e.letterGrade || '',
      enrolledAt: e.enrolledAt ? e.enrolledAt.toISOString() : '',
    }));

    return this.csvExportService.generateCsv(exportData);
  }

  async findOne(id: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id },
      include: {
        student: { include: { user: true } },
        section: { include: { course: true, lecturer: true } },
        semester: true,
      },
    });

    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    return this.hydrateEnrollment(enrollment);
  }

  async update(
    id: string,
    data: { status?: string; finalGrade?: number; letterGrade?: string },
  ) {
    const result = await this.withSerializableTransaction(async (tx) => {
      const enrollment = await this.getLockedEnrollmentForMutation(tx, id);

      if (data.status && data.status !== enrollment.status) {
        const validTransitions: Record<string, string[]> = {
          PENDING: ['CONFIRMED', 'CANCELLED'],
          CONFIRMED: ['COMPLETED', 'DROPPED', 'CANCELLED'],
          COMPLETED: [],
          DROPPED: [],
          CANCELLED: [],
        };

        const allowedStatuses = validTransitions[enrollment.status] || [];
        if (!allowedStatuses.includes(data.status)) {
          throw new BadRequestException(
            `Cannot change status from ${enrollment.status} to ${data.status}`,
          );
        }
      }

      const updateData: Prisma.EnrollmentUpdateInput = {};
      if (data.status !== undefined) {
        updateData.status = data.status as EnrollmentStatus;
      }
      if (data.finalGrade !== undefined) {
        updateData.finalGrade = data.finalGrade;
      }
      if (data.letterGrade !== undefined) {
        updateData.letterGrade = data.letterGrade;
      }

      const nextStatus =
        (data.status as EnrollmentStatus | undefined) ?? enrollment.status;
      const seatWasReleased =
        this.isSeatConsumingStatus(enrollment.status) &&
        !this.isSeatConsumingStatus(nextStatus);
      const shouldNotifyDropped =
        nextStatus === EnrollmentStatus.DROPPED &&
        enrollment.status !== EnrollmentStatus.DROPPED;

      if (
        seatWasReleased &&
        nextStatus === EnrollmentStatus.DROPPED &&
        !enrollment.droppedAt
      ) {
        updateData.droppedAt = new Date();
      }

      const updatedEnrollment = await tx.enrollment.update({
        where: { id },
        data: updateData,
        include: {
          student: { include: { user: true } },
          section: {
            include: { course: true, lecturer: { include: { user: true } } },
          },
          semester: true,
        },
      });

      const promotedEnrollments = seatWasReleased
        ? await this.handleSeatAvailability(tx, enrollment.sectionId)
        : [];

      return { promotedEnrollments, shouldNotifyDropped, updatedEnrollment };
    });

    if (result.shouldNotifyDropped) {
      this.publishEnrollmentNotification(
        result.updatedEnrollment,
        'enrollment.dropped',
      );
    }
    for (const promotedEnrollment of result.promotedEnrollments) {
      this.publishEnrollmentNotification(
        promotedEnrollment,
        'enrollment.promoted',
      );
    }

    return this.hydrateEnrollment(result.updatedEnrollment);
  }

  async remove(id: string) {
    const promotedEnrollments = await this.withSerializableTransaction(
      async (tx) => {
        const enrollment = await this.getLockedEnrollmentForMutation(tx, id);

        await tx.enrollment.delete({ where: { id } });

        if (this.isSeatConsumingStatus(enrollment.status)) {
          return this.handleSeatAvailability(tx, enrollment.sectionId);
        }
        return [];
      },
    );

    for (const promotedEnrollment of promotedEnrollments) {
      this.publishEnrollmentNotification(
        promotedEnrollment,
        'enrollment.promoted',
      );
    }

    return { message: 'Enrollment deleted successfully' };
  }

  async getStudentGrades(studentId: string, semesterId?: string) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        studentId,
        ...(semesterId ? { semesterId } : {}),
        OR: [
          { status: EnrollmentStatus.COMPLETED },
          { gradeStatus: { in: ['PUBLISHED', 'APPEALED'] } },
        ],
      },
      include: {
        section: {
          include: {
            course: true,
            lecturer: { include: { user: true } },
          },
        },
        semester: {
          include: { academicYear: true },
        },
      },
      orderBy: [
        { semester: { academicYear: { year: 'desc' } } },
        { semester: { startDate: 'desc' } },
      ],
    });

    return enrollments.map((enrollment) => ({
      id: enrollment.id,
      courseCode: enrollment.section.course.code,
      courseName: enrollment.section.course.name,
      courseNameEn: enrollment.section.course.nameEn,
      courseNameVi: enrollment.section.course.nameVi,
      credits: enrollment.section.course.credits,
      sectionCode: enrollment.section.sectionNumber,
      lecturerName: enrollment.section.lecturer?.user
        ? `${enrollment.section.lecturer.user.firstName} ${enrollment.section.lecturer.user.lastName}`
        : null,
      semester: enrollment.semester.name,
      semesterNameEn: enrollment.semester.nameEn,
      semesterNameVi: enrollment.semester.nameVi,
      semesterId: enrollment.semesterId,
      finalGrade: enrollment.finalGrade ? Number(enrollment.finalGrade) : null,
      letterGrade: enrollment.letterGrade,
      gradeStatus: enrollment.gradeStatus,
      enrollmentStatus: enrollment.status,
    }));
  }

  async getStudentTranscript(studentId: string) {
    const grades = await this.getStudentGrades(studentId);

    const gradePoints: Record<string, number> = {
      'A+': 4.0,
      A: 4.0,
      'A-': 3.7,
      'B+': 3.3,
      B: 3.0,
      'B-': 2.7,
      'C+': 2.3,
      C: 2.0,
      'C-': 1.7,
      'D+': 1.3,
      D: 1.0,
      'D-': 0.7,
      F: 0.0,
    };

    let totalCreditsAttempted = 0;
    let totalCreditsEarned = 0;
    let totalGradePoints = 0;

    const semestersMap = new Map<string, TranscriptSemesterAccumulator>();

    for (const record of grades) {
      if (!semestersMap.has(record.semesterId)) {
        semestersMap.set(record.semesterId, {
          semesterId: record.semesterId,
          semesterName: record.semester,
          semesterNameEn: record.semesterNameEn ?? record.semester,
          semesterNameVi: record.semesterNameVi ?? null,
          records: [],
          gpa: 0,
          creditsEarned: 0,
          creditsAttempted: 0,
          gradePoints: 0,
        });
      }

      const sem = semestersMap.get(record.semesterId)!;

      sem.records.push(record);

      if (record.letterGrade && gradePoints[record.letterGrade] !== undefined) {
        const points = gradePoints[record.letterGrade] * record.credits;
        sem.creditsAttempted += record.credits;
        sem.gradePoints += points;
        totalCreditsAttempted += record.credits;
        totalGradePoints += points;

        if (record.letterGrade !== 'F') {
          sem.creditsEarned += record.credits;
          totalCreditsEarned += record.credits;
        }
      } else if (record.enrollmentStatus === 'COMPLETED') {
        sem.creditsEarned += record.credits;
        totalCreditsEarned += record.credits;
      }
    }

    const semesters = Array.from(semestersMap.values()).map((sem) => {
      return {
        semesterId: sem.semesterId,
        semesterName: sem.semesterName,
        semesterNameEn: sem.semesterNameEn,
        semesterNameVi: sem.semesterNameVi,
        records: sem.records,
        gpa:
          sem.creditsAttempted > 0
            ? Number((sem.gradePoints / sem.creditsAttempted).toFixed(2))
            : 0,
        creditsEarned: sem.creditsEarned,
        creditsAttempted: sem.creditsAttempted,
      };
    });

    const cumulativeGpa =
      totalCreditsAttempted > 0
        ? Number((totalGradePoints / totalCreditsAttempted).toFixed(2))
        : 0;

    return {
      summary: {
        cumulativeGpa,
        totalCreditsEarned,
        totalCreditsAttempted,
      },
      semesters,
    };
  }

  private async withSerializableTransaction<T>(
    operation: (tx: EnrollmentTransaction) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= TRANSACTION_RETRY_LIMIT; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (
          !this.isRetryableTransactionError(error) ||
          attempt === TRANSACTION_RETRY_LIMIT
        ) {
          throw error;
        }
      }
    }

    throw new Error('Unreachable enrollment transaction retry state');
  }

  private isRetryableTransactionError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2034'
    );
  }

  private async getSectionEnrollmentContext(
    tx: EnrollmentTransaction,
    sectionId: string,
  ): Promise<SectionEnrollmentContext> {
    await this.lockSection(tx, sectionId);

    const section = await tx.section.findUnique({
      where: { id: sectionId },
      include: {
        course: {
          include: {
            prerequisites: {
              include: { prerequisite: true },
            },
          },
        },
        semester: true,
        schedules: { include: { classroom: true } },
      },
    });

    if (!section) {
      throw new NotFoundException('Section not found');
    }

    return section;
  }

  private async lockSection(tx: EnrollmentTransaction, sectionId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Section"
      WHERE "id" = ${sectionId}
      FOR UPDATE
    `;

    if (rows.length === 0) {
      throw new NotFoundException('Section not found');
    }
  }

  private assertSectionOpenForEnrollment(section: SectionEnrollmentContext) {
    if (section.status !== 'OPEN') {
      throw new BadRequestException('Section is not open for enrollment');
    }

    this.assertEnrollmentWindowOpen(section.semester);
  }

  private assertEnrollmentWindowOpen(
    semester: SectionEnrollmentContext['semester'],
    now = new Date(),
  ) {
    if (semester.registrationStart && now < semester.registrationStart) {
      throw new ForbiddenException('Registration has not started yet');
    }

    const withinRegistrationWindow =
      (!semester.registrationStart || now >= semester.registrationStart) &&
      (!semester.registrationEnd || now <= semester.registrationEnd);
    const withinAddDropWindow =
      (!semester.addDropStart || now >= semester.addDropStart) &&
      (!semester.addDropEnd || now <= semester.addDropEnd);

    if (withinRegistrationWindow || withinAddDropWindow) {
      return;
    }

    if (semester.addDropEnd && now > semester.addDropEnd) {
      throw new ForbiddenException('Add/drop period has ended');
    }

    if (semester.registrationEnd && now > semester.registrationEnd) {
      throw new ForbiddenException('Registration has ended');
    }

    throw new ForbiddenException('Enrollment is not currently allowed');
  }

  private async assertStudentNotAlreadyQueued(
    tx: EnrollmentTransaction,
    studentId: string,
    sectionId: string,
  ) {
    const existingEnrollment = await tx.enrollment.findFirst({
      where: { studentId, sectionId },
    });

    if (existingEnrollment) {
      throw new BadRequestException('Already enrolled in this section');
    }

    const existingWaitlist = await tx.waitlist.findFirst({
      where: { studentId, sectionId },
    });

    if (existingWaitlist) {
      throw new BadRequestException('Already on waitlist for this section');
    }
  }

  private async assertStudentEligibleForSection(
    tx: EnrollmentTransaction,
    studentId: string,
    section: SectionEnrollmentContext,
  ) {
    await this.assertStudentHasCompletedPrerequisites(tx, studentId, section);

    const currentEnrollments = await this.getStudentSeatConsumingEnrollments(
      tx,
      studentId,
      section.semesterId,
    );

    this.assertNoScheduleConflicts(currentEnrollments, section.schedules);
    this.assertCreditLimit(section, currentEnrollments);
  }

  private async assertStudentHasCompletedPrerequisites(
    tx: EnrollmentTransaction,
    studentId: string,
    section: SectionEnrollmentContext,
  ) {
    if (section.course.prerequisites.length === 0) {
      return;
    }

    const completedCourses = await tx.enrollment.findMany({
      where: {
        studentId,
        status: EnrollmentStatus.COMPLETED,
      },
      select: {
        section: {
          select: {
            courseId: true,
          },
        },
      },
    });

    const completedCourseIds = new Set(
      completedCourses.map((enrollment) => enrollment.section.courseId),
    );
    const missingPrerequisites = section.course.prerequisites
      .filter(
        (prerequisite) => !completedCourseIds.has(prerequisite.prerequisiteId),
      )
      .map((prerequisite) => prerequisite.prerequisite.code);

    if (missingPrerequisites.length > 0) {
      throw new BadRequestException(
        `Missing prerequisites: ${missingPrerequisites.join(', ')}`,
      );
    }
  }

  private async getStudentSeatConsumingEnrollments(
    tx: EnrollmentTransaction,
    studentId: string,
    semesterId: string,
  ): Promise<StudentSemesterEnrollment[]> {
    return tx.enrollment.findMany({
      where: {
        studentId,
        status: { in: SEAT_CONSUMING_STATUSES },
        section: {
          semesterId,
        },
      },
      include: {
        section: {
          include: {
            schedules: true,
            course: true,
          },
        },
      },
    });
  }

  private assertNoScheduleConflicts(
    currentEnrollments: StudentSemesterEnrollment[],
    newSchedules: SectionEnrollmentContext['schedules'],
  ) {
    const studentSchedules = currentEnrollments.flatMap(
      (enrollment) => enrollment.section.schedules,
    );

    for (const newSchedule of newSchedules) {
      for (const existingSchedule of studentSchedules) {
        if (newSchedule.dayOfWeek !== existingSchedule.dayOfWeek) {
          continue;
        }

        const newStart = this.timeToMinutes(newSchedule.startTime);
        const newEnd = this.timeToMinutes(newSchedule.endTime);
        const existingStart = this.timeToMinutes(existingSchedule.startTime);
        const existingEnd = this.timeToMinutes(existingSchedule.endTime);

        if (newStart < existingEnd && newEnd > existingStart) {
          throw new BadRequestException(
            `Schedule conflict with section (${existingSchedule.dayOfWeek} ${existingSchedule.startTime}-${existingSchedule.endTime})`,
          );
        }
      }
    }
  }

  private assertCreditLimit(
    section: SectionEnrollmentContext,
    currentEnrollments: StudentSemesterEnrollment[],
  ) {
    const currentCredits = currentEnrollments.reduce(
      (sum, enrollment) => sum + enrollment.section.course.credits,
      0,
    );
    const newCredits = currentCredits + section.course.credits;
    const maxCredits = section.maxCredits || 21;

    if (newCredits > maxCredits) {
      throw new BadRequestException(
        `Exceeds maximum credits (${newCredits} > ${maxCredits})`,
      );
    }
  }

  private async addStudentToWaitlist(
    tx: EnrollmentTransaction,
    studentId: string,
    sectionId: string,
  ) {
    const lastPosition = await tx.waitlist.findFirst({
      where: {
        sectionId,
        status: WaitlistStatus.ACTIVE,
      },
      orderBy: { position: 'desc' },
    });

    return tx.waitlist.create({
      data: {
        studentId,
        sectionId,
        position: (lastPosition?.position ?? 0) + 1,
        status: WaitlistStatus.ACTIVE,
      },
      include: {
        student: { include: { user: true } },
        section: { include: { course: true, semester: true } },
      },
    });
  }

  private async syncSectionEnrolledCount(
    tx: EnrollmentTransaction,
    sectionId: string,
  ) {
    const activeEnrollmentCount = await tx.enrollment.count({
      where: {
        sectionId,
        status: { in: SEAT_CONSUMING_STATUSES },
      },
    });

    await tx.section.update({
      where: { id: sectionId },
      data: { enrolledCount: activeEnrollmentCount },
    });

    return activeEnrollmentCount;
  }

  private async handleSeatAvailability(
    tx: EnrollmentTransaction,
    sectionId: string,
  ): Promise<EnrollmentNotificationRecord[]> {
    const section = await this.getSectionEnrollmentContext(tx, sectionId);
    let currentEnrollmentCount = await this.syncSectionEnrolledCount(
      tx,
      sectionId,
    );
    const promotedEnrollments: EnrollmentNotificationRecord[] = [];

    if (
      section.status !== 'OPEN' ||
      currentEnrollmentCount >= section.capacity
    ) {
      await this.resequenceWaitlist(tx, sectionId);
      return promotedEnrollments;
    }

    let enrollmentWindowOpen = true;
    try {
      this.assertEnrollmentWindowOpen(section.semester);
    } catch (error) {
      if (error instanceof ForbiddenException) {
        enrollmentWindowOpen = false;
      } else {
        throw error;
      }
    }

    if (!enrollmentWindowOpen) {
      await this.resequenceWaitlist(tx, sectionId);
      return promotedEnrollments;
    }

    const waitlistEntries = await tx.waitlist.findMany({
      where: {
        sectionId,
        status: WaitlistStatus.ACTIVE,
      },
      orderBy: [{ position: 'asc' }, { addedAt: 'asc' }],
    });

    for (const entry of waitlistEntries) {
      const existingEnrollment = await tx.enrollment.findFirst({
        where: {
          studentId: entry.studentId,
          sectionId,
        },
      });

      if (existingEnrollment) {
        await tx.waitlist.update({
          where: { id: entry.id },
          data: { status: WaitlistStatus.CANCELLED },
        });
        continue;
      }

      try {
        await this.assertStudentEligibleForSection(
          tx,
          entry.studentId,
          section,
        );
      } catch (error) {
        if (
          error instanceof BadRequestException ||
          error instanceof ForbiddenException
        ) {
          await tx.waitlist.update({
            where: { id: entry.id },
            data: { status: WaitlistStatus.EXPIRED },
          });
          continue;
        }

        throw error;
      }

      const promotedEnrollment = await tx.enrollment.create({
        data: {
          studentId: entry.studentId,
          sectionId,
          semesterId: section.semesterId,
          status: EnrollmentStatus.PENDING,
        },
        include: {
          student: { include: { user: true } },
          section: { include: { course: true, semester: true } },
        },
      });
      promotedEnrollments.push(promotedEnrollment);

      await tx.waitlist.update({
        where: { id: entry.id },
        data: {
          status: WaitlistStatus.CONVERTED,
          convertedAt: new Date(),
        },
      });

      currentEnrollmentCount = await this.syncSectionEnrolledCount(
        tx,
        sectionId,
      );
      if (currentEnrollmentCount >= section.capacity) {
        break;
      }
    }

    await this.resequenceWaitlist(tx, sectionId);
    return promotedEnrollments;
  }

  private async resequenceWaitlist(
    tx: EnrollmentTransaction,
    sectionId: string,
  ) {
    await tx.$executeRaw`
      WITH ranked AS (
        SELECT
          "id",
          ROW_NUMBER() OVER (
            ORDER BY "position" ASC, "addedAt" ASC, "id" ASC
          ) AS new_position
        FROM "Waitlist"
        WHERE "sectionId" = ${sectionId}
          AND "status" = ${WaitlistStatus.ACTIVE}
      )
      UPDATE "Waitlist" AS waitlist
      SET "position" = ranked.new_position
      FROM ranked
      WHERE waitlist."id" = ranked."id"
        AND waitlist."position" <> ranked.new_position
    `;
  }

  private publishEnrollmentNotification(
    enrollment: EnrollmentNotificationRecord,
    template: EnrollmentNotificationTemplate,
  ) {
    this.publishEnrollmentNotificationEvent(enrollment, template).catch(
      (error) => {
        this.logger.warn(
          `Enrollment notification fanout failed for ${enrollment.id}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      },
    );
  }

  private async publishEnrollmentNotificationEvent(
    enrollment: EnrollmentNotificationRecord,
    template: EnrollmentNotificationTemplate,
  ) {
    const user = enrollment.student.user;
    const course = enrollment.section?.course;
    const sectionNumber = enrollment.section?.sectionNumber;

    if (!user?.email || !user.id || !course || !sectionNumber) {
      this.logger.warn(
        `Enrollment ${enrollment.id} is missing user/course data for notification fanout`,
      );
      return;
    }

    const courseName = course.nameEn ?? course.name ?? 'Course';
    const courseNameVi =
      course.nameVi ?? course.nameEn ?? course.name ?? courseName;
    const courseLabel = course.code
      ? `${course.code} - ${courseName}`
      : courseName;
    const semester = enrollment.section?.semester ?? enrollment.semester;
    const copyByTemplate: Record<
      EnrollmentNotificationTemplate,
      {
        idPrefix: string;
        title: string;
        message: string;
        type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
        link: string;
      }
    > = {
      'enrollment.confirmed': {
        idPrefix: 'enrollment-confirmed',
        title: 'Enrollment submitted',
        message: `Your enrollment for ${courseLabel} section ${sectionNumber} has been submitted.`,
        type: 'SUCCESS',
        link: '/dashboard/enrollments',
      },
      'enrollment.waitlisted': {
        idPrefix: 'enrollment-waitlisted',
        title: 'Waitlist joined',
        message: `${courseLabel} section ${sectionNumber} is full. You have been added to the waitlist.`,
        type: 'INFO',
        link: '/dashboard/register',
      },
      'enrollment.promoted': {
        idPrefix: 'enrollment-promoted',
        title: 'Waitlist seat opened',
        message: `A seat opened for ${courseLabel} section ${sectionNumber}. Your enrollment has been submitted.`,
        type: 'SUCCESS',
        link: '/dashboard/enrollments',
      },
      'enrollment.dropped': {
        idPrefix: 'enrollment-dropped',
        title: 'Course dropped',
        message: `You dropped ${courseLabel} section ${sectionNumber}.`,
        type: 'INFO',
        link: '/dashboard/enrollments',
      },
    };
    const copy = copyByTemplate[template];
    const event: AcademicEventEnvelope = {
      type: ACADEMIC_NOTIFICATION_EVENT_TYPES.NOTIFICATION_USER_CREATED,
      source: 'campuscore-academic-service',
      occurredAt: new Date().toISOString(),
      payload: {
        userId: user.id,
        notification: {
          id: `${copy.idPrefix}-${enrollment.id}`,
          title: copy.title,
          message: copy.message,
          type: copy.type,
          link: copy.link,
        },
        email: {
          to: user.email,
          template,
          locale: 'en',
          studentName:
            `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() ||
            user.email,
          courseCode: course.code ?? undefined,
          courseName,
          courseNameVi,
          sectionNumber,
          semesterName: semester?.nameEn ?? semester?.name ?? undefined,
          semesterNameVi:
            semester?.nameVi ?? semester?.nameEn ?? semester?.name ?? undefined,
          link: copy.link,
        },
      },
    };

    const published = await this.rabbitMQService.publishMessage(event);
    if (!published) {
      this.logger.warn(
        `Enrollment notification event was not published for ${enrollment.id}`,
      );
    }
  }

  private async getLockedEnrollmentForMutation(
    tx: EnrollmentTransaction,
    enrollmentId: string,
  ) {
    const enrollmentPointer = await tx.enrollment.findUnique({
      where: { id: enrollmentId },
      select: { sectionId: true },
    });

    if (!enrollmentPointer) {
      throw new NotFoundException('Enrollment not found');
    }

    await this.lockSection(tx, enrollmentPointer.sectionId);

    const enrollment = await tx.enrollment.findUnique({
      where: { id: enrollmentId },
      include: {
        student: { include: { user: true } },
        section: {
          include: {
            course: true,
            lecturer: { include: { user: true } },
          },
        },
        semester: true,
      },
    });

    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    return enrollment;
  }

  private async getLockedWaitlistEntry(
    tx: EnrollmentTransaction,
    waitlistEntryId: string,
  ) {
    const entryPointer = await tx.waitlist.findUnique({
      where: { id: waitlistEntryId },
      select: { sectionId: true },
    });

    if (!entryPointer) {
      throw new NotFoundException('Waitlist entry not found');
    }

    await this.lockSection(tx, entryPointer.sectionId);

    const entry = await tx.waitlist.findUnique({
      where: { id: waitlistEntryId },
    });

    if (!entry) {
      throw new NotFoundException('Waitlist entry not found');
    }

    return entry;
  }

  private isSeatConsumingStatus(status: EnrollmentStatus) {
    return SEAT_CONSUMING_STATUSES.includes(status);
  }

  private timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private hydrateEnrollment<T extends { section?: any; semester?: any }>(
    enrollment: T,
  ) {
    return {
      ...enrollment,
      section: enrollment.section
        ? {
            ...enrollment.section,
            course: enrollment.section.course
              ? {
                  ...hydrateLocalizedCatalogRecord(
                    'course',
                    enrollment.section.course,
                  ),
                  department: enrollment.section.course.department
                    ? hydrateLocalizedCatalogRecord(
                        'department',
                        enrollment.section.course.department,
                      )
                    : enrollment.section.course.department,
                }
              : enrollment.section.course,
          }
        : enrollment.section,
      semester: enrollment.semester
        ? hydrateLocalizedCatalogRecord('semester', enrollment.semester)
        : enrollment.semester,
    };
  }
}
