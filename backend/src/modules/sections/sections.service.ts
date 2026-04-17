import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class SectionsService {
  constructor(private prisma: PrismaService) {}

  async createSection(data: any) {
    return this.prisma.section.create({
      data,
      include: {
        course: true,
        semester: true,
        lecturer: true,
        classroom: true,
        enrollments: true,
        waitlists: true,
      },
    });
  }

  async findAllSections(
    page = 1,
    limit = 100,
    semesterId?: string,
    departmentId?: string,
    courseId?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (semesterId) {
      where.semesterId = semesterId;
    }
    if (courseId) {
      where.courseId = courseId;
    }
    if (departmentId) {
      where.course = { departmentId };
    }

    const [sections, total] = await Promise.all([
      this.prisma.section.findMany({
        skip,
        take: limit,
        where,
        include: {
          course: { include: { department: true } },
          semester: true,
          lecturer: { include: { user: true } },
          schedules: true,
          classroom: true,
        },
        orderBy: { sectionNumber: 'asc' },
      }),
      this.prisma.section.count({ where }),
    ]);
    return {
      data: sections,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findLecturerSchedule(lecturerId: string, semesterId?: string) {
    const where: {
      lecturerId: string;
      semesterId?: string;
    } = { lecturerId };

    if (semesterId) {
      where.semesterId = semesterId;
    }

    const sections = await this.prisma.section.findMany({
      where,
      include: {
        course: { include: { department: true } },
        schedules: { include: { classroom: true } },
        classroom: true,
        _count: {
          select: {
            enrollments: {
              where: {
                status: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] },
              },
            },
          },
        },
      },
      orderBy: [{ course: { code: 'asc' } }, { sectionNumber: 'asc' }],
    });

    return sections.map((section) => ({
      id: section.id,
      sectionId: section.id,
      sectionNumber: section.sectionNumber,
      courseCode: section.course.code,
      courseName: section.course.name,
      credits: section.course.credits,
      capacity: section.capacity,
      enrolledCount: section._count.enrollments || section.enrolledCount,
      departmentName: section.course.department.name,
      status: section.status,
      schedules: section.schedules
        .map((schedule) => ({
          id: schedule.id,
          dayOfWeek: schedule.dayOfWeek,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          building:
            schedule.classroom?.building ||
            section.classroom?.building ||
            'TBA',
          roomNumber:
            schedule.classroom?.roomNumber ||
            section.classroom?.roomNumber ||
            'TBA',
        }))
        .sort((a, b) => {
          if (a.dayOfWeek !== b.dayOfWeek) {
            return a.dayOfWeek - b.dayOfWeek;
          }
          return a.startTime.localeCompare(b.startTime);
        }),
    }));
  }

  async findLecturerGradingSections(lecturerId: string, semesterId?: string) {
    const where: {
      lecturerId: string;
      semesterId?: string;
    } = { lecturerId };

    if (semesterId) {
      where.semesterId = semesterId;
    }

    const sections = await this.prisma.section.findMany({
      where,
      include: {
        course: { include: { department: true } },
        semester: true,
        enrollments: {
          where: { status: { in: ['CONFIRMED', 'COMPLETED'] } },
          select: {
            id: true,
            finalGrade: true,
            gradeStatus: true,
          },
        },
      },
      orderBy: [{ semester: { startDate: 'desc' } }, { sectionNumber: 'asc' }],
    });

    return sections.map((section) => {
      const enrolledCount = section.enrollments.length;
      const gradedCount = section.enrollments.filter(
        (enrollment) => enrollment.finalGrade !== null,
      ).length;
      const publishedCount = section.enrollments.filter(
        (enrollment) => enrollment.gradeStatus === 'PUBLISHED',
      ).length;
      const gradeStatus =
        gradedCount === 0
          ? 'NONE'
          : gradedCount >= enrolledCount && enrolledCount > 0
            ? 'ALL_GRADED'
            : 'PARTIAL';

      return {
        id: section.id,
        sectionId: section.id,
        sectionNumber: section.sectionNumber,
        courseCode: section.course.code,
        courseName: section.course.name,
        credits: section.course.credits,
        departmentName: section.course.department.name,
        semester: section.semester.name,
        semesterName: section.semester.name,
        enrolledCount,
        gradedCount,
        publishedCount,
        gradeStatus,
        canPublish:
          enrolledCount > 0 &&
          gradedCount >= enrolledCount &&
          publishedCount < enrolledCount,
      };
    });
  }

  async findOneSection(id: string) {
    const section = await this.prisma.section.findUnique({
      where: { id },
      include: {
        course: true,
        semester: true,
        lecturer: true,
        classroom: true,
        enrollments: true,
        waitlists: true,
      },
    });
    if (!section) throw new NotFoundException('Section not found');
    return section;
  }

  async updateSection(id: string, data: any) {
    await this.findOneSection(id);
    return this.prisma.section.update({
      where: { id },
      data,
      include: { course: true, lecturer: true },
    });
  }

  async removeSection(id: string) {
    await this.findOneSection(id);
    await this.prisma.section.delete({ where: { id } });
    return { message: 'Section deleted successfully' };
  }

  async getSectionGrades(sectionId: string) {
    const section = await this.prisma.section.findUnique({
      where: { id: sectionId },
      include: {
        course: { include: { department: true } },
        semester: true,
        lecturer: { include: { user: true } },
        enrollments: {
          include: {
            student: { include: { user: true } },
          },
          where: { status: { in: ['CONFIRMED', 'COMPLETED'] } },
        },
      },
    });
    if (!section) throw new NotFoundException('Section not found');

    return {
      sectionId: section.id,
      sectionNumber: section.sectionNumber,
      courseCode: section.course.code,
      courseName: section.course.name,
      credits: section.course.credits,
      departmentName: section.course.department.name,
      semester: section.semester.name,
      lecturerName: section.lecturer
        ? `${section.lecturer.user.firstName} ${section.lecturer.user.lastName}`
        : undefined,
      status: section.status,
      enrollments: section.enrollments.map((enrollment) => ({
        id: enrollment.id,
        studentId: enrollment.studentId,
        studentName: `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`,
        studentCode: enrollment.student.studentId,
        email: enrollment.student.user.email,
        finalGrade: enrollment.finalGrade,
        letterGrade: enrollment.letterGrade,
        gradeStatus: enrollment.gradeStatus,
        enrollmentStatus: enrollment.status,
      })),
    };
  }

  async updateSectionGrades(
    sectionId: string,
    grades: { enrollmentId: string; finalGrade: number; letterGrade: string }[],
  ) {
    await this.findOneSection(sectionId);

    const updates = grades.map((grade) =>
      this.prisma.enrollment.update({
        where: { id: grade.enrollmentId },
        data: {
          finalGrade: grade.finalGrade,
          letterGrade: grade.letterGrade,
          gradeStatus: 'DRAFT',
          status: 'COMPLETED',
        },
      }),
    );

    await this.prisma.$transaction(updates);
    return { message: 'Grades updated successfully' };
  }

  async publishSectionGrades(sectionId: string) {
    const section = await this.prisma.section.findUnique({
      where: { id: sectionId },
      include: { enrollments: true },
    });
    if (!section) throw new NotFoundException('Section not found');

    await this.prisma.enrollment.updateMany({
      where: {
        sectionId,
        status: { in: ['CONFIRMED', 'COMPLETED'] },
        finalGrade: { not: null },
      },
      data: { gradeStatus: 'PUBLISHED' },
    });

    return { message: 'Grades published successfully' };
  }
}
