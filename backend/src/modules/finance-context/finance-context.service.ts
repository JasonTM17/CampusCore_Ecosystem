import { Injectable, NotFoundException } from '@nestjs/common';
import { EnrollmentStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

const DEFAULT_TUITION_PER_CREDIT = 150;

@Injectable()
export class FinanceContextService {
  constructor(private readonly prisma: PrismaService) {}

  async getStudent(studentId: string) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: {
        user: true,
      },
    });

    if (!student || !student.user) {
      throw new NotFoundException('Student not found');
    }

    return {
      id: student.id,
      userId: student.user.id,
      studentCode: student.studentId,
      displayName: [student.user.firstName, student.user.lastName]
        .filter(Boolean)
        .join(' ')
        .trim(),
      email: student.user.email,
    };
  }

  async getSemester(semesterId: string) {
    const semester = await this.prisma.semester.findUnique({
      where: { id: semesterId },
    });

    if (!semester) {
      throw new NotFoundException('Semester not found');
    }

    return {
      id: semester.id,
      name: semester.name,
      endDate: semester.endDate?.toISOString() ?? null,
    };
  }

  async getBillableStudents(semesterId: string) {
    await this.getSemester(semesterId);

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        semesterId,
        status: {
          in: [EnrollmentStatus.CONFIRMED, EnrollmentStatus.COMPLETED],
        },
      },
      include: {
        student: {
          include: {
            user: true,
          },
        },
        section: {
          include: {
            course: true,
          },
        },
      },
      orderBy: {
        studentId: 'asc',
      },
    });

    const students = new Map<
      string,
      {
        id: string;
        userId: string;
        studentCode: string;
        displayName: string;
        email: string;
        items: Array<{
          description: string;
          quantity: number;
          unitPrice: number;
        }>;
      }
    >();

    for (const enrollment of enrollments) {
      const student = enrollment.student;
      const user = student.user;
      if (!user) {
        continue;
      }

      const existing = students.get(student.id) ?? {
        id: student.id,
        userId: user.id,
        studentCode: student.studentId,
        displayName: [user.firstName, user.lastName]
          .filter(Boolean)
          .join(' ')
          .trim(),
        email: user.email,
        items: [],
      };

      existing.items.push({
        description: `${enrollment.section.course.code} - ${enrollment.section.course.name} (${enrollment.section.course.credits} credits)`,
        quantity: enrollment.section.course.credits,
        unitPrice: DEFAULT_TUITION_PER_CREDIT,
      });

      students.set(student.id, existing);
    }

    return {
      semesterId,
      students: Array.from(students.values()),
    };
  }
}
