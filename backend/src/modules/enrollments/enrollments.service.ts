import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { Prisma, EnrollmentStatus, WaitlistStatus } from '@prisma/client';

@Injectable()
export class EnrollmentsService {
  constructor(private prisma: PrismaService) {}

  async enrollStudent(studentId: string, sectionId: string) {
    const section = await this.prisma.section.findUnique({
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
        enrollments: true,
        schedules: { include: { classroom: true } },
      },
    });

    if (!section) {
      throw new NotFoundException('Section not found');
    }

    if (section.status !== 'OPEN') {
      throw new BadRequestException('Section is not open for enrollment');
    }

    // Check if student is already enrolled
    const existingEnrollment = await this.prisma.enrollment.findFirst({
      where: { studentId, sectionId },
    });
    if (existingEnrollment) {
      throw new BadRequestException('Already enrolled in this section');
    }

    // Check if student is already on waitlist
    const existingWaitlist = await this.prisma.waitlist.findFirst({
      where: { studentId, sectionId },
    });
    if (existingWaitlist) {
      throw new BadRequestException('Already on waitlist for this section');
    }

    // Validate registration window
    const now = new Date();
    const semester = section.semester;
    if (semester.registrationStart && now < semester.registrationStart) {
      throw new ForbiddenException('Registration has not started yet');
    }
    if (semester.registrationEnd && now > semester.registrationEnd) {
      throw new ForbiddenException('Registration has ended');
    }
    if (semester.addDropStart && semester.addDropEnd && now > semester.addDropEnd) {
      throw new ForbiddenException('Add/drop period has ended');
    }

    // Check capacity and handle waitlist
    const currentEnrollment = section.enrollments.filter(
      (e) => e.status === EnrollmentStatus.CONFIRMED || e.status === EnrollmentStatus.PENDING,
    ).length;

    if (currentEnrollment >= section.capacity) {
      // Add to waitlist instead
      const lastPosition = await this.prisma.waitlist.findFirst({
        where: { sectionId },
        orderBy: { position: 'desc' },
      });
      const newPosition = lastPosition ? lastPosition.position + 1 : 1;

      return this.prisma.waitlist.create({
        data: {
          studentId,
          sectionId,
          position: newPosition,
          status: WaitlistStatus.ACTIVE,
        },
        include: { student: true, section: true },
      });
    }

    // Validate prerequisites
    const completedEnrollments = await this.prisma.enrollment.findMany({
      where: {
        studentId,
        status: EnrollmentStatus.COMPLETED,
        section: {
          course: {
            prerequisites: {
              some: {
                prerequisite: {
                  id: section.course.id,
                },
              },
            },
          },
        },
      },
    });

    const missingPrerequisites = section.course.prerequisites
      .filter((prereq) => {
        const hasCompleted = completedEnrollments.some((enrollment) => {
          return enrollment.sectionId === prereq.prerequisite.id;
        });
        return !hasCompleted;
      })
      .map((prereq) => prereq.prerequisite.code);

    if (missingPrerequisites.length > 0) {
      throw new BadRequestException(
        `Missing prerequisites: ${missingPrerequisites.join(', ')}`,
      );
    }

    // Check schedule conflicts
    const studentEnrollmentsData = await this.prisma.enrollment.findMany({
      where: {
        studentId,
        status: { in: [EnrollmentStatus.CONFIRMED, EnrollmentStatus.PENDING] },
        section: {
          semesterId: section.semesterId,
        },
      },
      include: {
        section: {
          include: { schedules: true },
        },
      },
    });

    const studentSchedules = studentEnrollmentsData.flatMap((e) => e.section.schedules);
    const newSchedules = section.schedules;

    for (const newSched of newSchedules) {
      for (const existingSched of studentSchedules) {
        if (newSched.dayOfWeek === existingSched.dayOfWeek) {
          const newStart = this.timeToMinutes(newSched.startTime);
          const newEnd = this.timeToMinutes(newSched.endTime);
          const existStart = this.timeToMinutes(existingSched.startTime);
          const existEnd = this.timeToMinutes(existingSched.endTime);

          if (newStart < existEnd && newEnd > existStart) {
            throw new BadRequestException(
              `Schedule conflict with section (${existingSched.dayOfWeek} ${existingSched.startTime}-${existingSched.endTime})`,
            );
          }
        }
      }
    }

    // Validate max credits
    const studentYear = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { curriculum: true },
    });

    if (studentYear) {
      const studentEnrollmentsData = await this.prisma.enrollment.findMany({
        where: {
          studentId,
          status: { in: [EnrollmentStatus.CONFIRMED, EnrollmentStatus.PENDING] },
          section: {
            semesterId: section.semesterId,
          },
        },
        include: {
          section: { include: { course: true } },
        },
      });

      const currentCredits = studentEnrollmentsData.reduce((sum, e) => sum + e.section.course.credits, 0);
      const newCredits = currentCredits + section.course.credits;

      const maxCredits = section.maxCredits || 21; // Default max credits
      if (newCredits > maxCredits) {
        throw new BadRequestException(
          `Exceeds maximum credits (${newCredits} > ${maxCredits})`,
        );
      }
    }

    // Create enrollment
    return this.prisma.enrollment.create({
      data: {
        studentId,
        sectionId,
        semesterId: section.semesterId,
        status: EnrollmentStatus.PENDING,
      },
      include: {
        student: { include: { user: true } },
        section: { include: { course: true } },
      },
    });
  }

  async dropEnrollment(enrollmentId: string, studentId: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: { section: true },
    });

    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    if (enrollment.studentId !== studentId) {
      throw new ForbiddenException('Not authorized to drop this enrollment');
    }

    const semester = await this.prisma.semester.findUnique({
      where: { id: enrollment.semesterId },
    });

    // Check if within add/drop period
    const now = new Date();
    if (semester?.addDropEnd && now > semester.addDropEnd) {
      throw new ForbiddenException('Add/drop period has ended');
    }

    // Delete enrollment
    await this.prisma.enrollment.delete({ where: { id: enrollmentId } });

    // Promote from waitlist if available
    const nextInLine = await this.prisma.waitlist.findFirst({
      where: { sectionId: enrollment.sectionId, status: WaitlistStatus.ACTIVE },
      orderBy: { position: 'asc' },
    });

    if (nextInLine) {
      await this.prisma.$transaction([
        this.prisma.enrollment.create({
          data: {
            studentId: nextInLine.studentId,
            sectionId: enrollment.sectionId,
            semesterId: enrollment.semesterId,
            status: EnrollmentStatus.PENDING,
          },
        }),
        this.prisma.waitlist.update({
          where: { id: nextInLine.id },
          data: { status: WaitlistStatus.CONVERTED, convertedAt: new Date() },
        }),
      ]);

      // Update waitlist positions
      const remaining = await this.prisma.waitlist.findMany({
        where: { sectionId: enrollment.sectionId, status: WaitlistStatus.ACTIVE },
        orderBy: { position: 'asc' },
      });

      for (let i = 0; i < remaining.length; i++) {
        await this.prisma.waitlist.update({
          where: { id: remaining[i].id },
          data: { position: i + 1 },
        });
      }
    }

    return { message: 'Enrollment dropped successfully' };
  }

  async getStudentEnrollments(studentId: string, semesterId?: string) {
    return this.prisma.enrollment.findMany({
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
  }

  async findAll(page = 1, limit = 20, status?: string) {
    const skip = (page - 1) * limit;
    const [enrollments, total] = await Promise.all([
      this.prisma.enrollment.findMany({
        skip,
        take: limit,
        where: status ? { status: status as EnrollmentStatus } : undefined,
        include: {
          student: { include: { user: true } },
          section: { include: { course: true } },
        },
        orderBy: { enrolledAt: 'desc' },
      }),
      this.prisma.enrollment.count({
        where: status ? { status: status as EnrollmentStatus } : undefined,
      }),
    ]);
    return { data: enrollments, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
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
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    return enrollment;
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.enrollment.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.enrollment.delete({ where: { id } });
    return { message: 'Enrollment deleted successfully' };
  }

  private timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }
}
