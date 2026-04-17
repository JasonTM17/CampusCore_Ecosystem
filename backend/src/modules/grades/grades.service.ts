import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class GradesService {
  constructor(private prisma: PrismaService) {}

  // ============ GRADE ITEMS ============

  async createGradeItem(data: any) {
    return this.prisma.gradeItem.create({ data, include: { section: true } });
  }

  async findAllGradeItems(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [gradeItems, total] = await Promise.all([
      this.prisma.gradeItem.findMany({
        skip,
        take: limit,
        include: { section: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.gradeItem.count(),
    ]);
    return {
      data: gradeItems,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findGradeItemsBySection(sectionId: string) {
    return this.prisma.gradeItem.findMany({
      where: { sectionId },
      include: { section: { include: { course: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findGradeItemsByLecturer(lecturerId: string) {
    const sections = await this.prisma.section.findMany({
      where: { lecturerId },
      select: { id: true },
    });
    const sectionIds = sections.map((s) => s.id);

    return this.prisma.gradeItem.findMany({
      where: { sectionId: { in: sectionIds } },
      include: {
        section: {
          include: {
            course: true,
            semester: true,
            lecturer: { include: { user: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOneGradeItem(id: string) {
    const gradeItem = await this.prisma.gradeItem.findUnique({
      where: { id },
      include: { section: true },
    });
    if (!gradeItem) throw new NotFoundException('Grade item not found');
    return gradeItem;
  }

  async updateGradeItem(id: string, data: any) {
    await this.findOneGradeItem(id);
    return this.prisma.gradeItem.update({
      where: { id },
      data,
      include: { section: true },
    });
  }

  async removeGradeItem(id: string) {
    await this.findOneGradeItem(id);
    await this.prisma.gradeItem.delete({ where: { id } });
    return { message: 'Grade item deleted successfully' };
  }

  // ============ STUDENT GRADES ============

  async createStudentGrade(data: any) {
    return this.prisma.studentGrade.create({
      data,
      include: { gradeItem: true, enrollment: true },
    });
  }

  async createBulkStudentGrades(grades: any[]) {
    const results = await this.prisma.studentGrade.createManyAndReturn({
      data: grades,
    });
    return results;
  }

  async findAllStudentGrades(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [studentGrades, total] = await Promise.all([
      this.prisma.studentGrade.findMany({
        skip,
        take: limit,
        include: { gradeItem: true, enrollment: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.studentGrade.count(),
    ]);
    return {
      data: studentGrades,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findStudentGradesBySection(sectionId: string) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { sectionId },
      include: {
        student: { include: { user: true } },
        section: { include: { course: true } },
        gradeItems: {
          include: { gradeItem: true },
        },
      },
    });

    return enrollments.map((enrollment) => {
      const grades = enrollment.gradeItems.map((g) => ({
        id: g.id,
        gradeItemId: g.gradeItemId,
        gradeItemName: g.gradeItem.name,
        gradeItemType: g.gradeItem.type,
        score: g.score ? Number(g.score) : null,
        maxScore: g.gradeItem.maxScore ? Number(g.gradeItem.maxScore) : null,
        weight: g.gradeItem.weight ? Number(g.gradeItem.weight) : null,
      }));

      // Calculate total score
      let totalScore = 0;
      let totalWeight = 0;
      grades.forEach((g) => {
        if (g.score !== null && g.maxScore && g.weight) {
          totalScore += (g.score / Number(g.maxScore)) * Number(g.weight);
          totalWeight += Number(g.weight);
        }
      });

      return {
        enrollmentId: enrollment.id,
        studentId: enrollment.studentId,
        studentName: enrollment.student.user
          ? `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`
          : '',
        studentNumber: enrollment.student.studentId,
        courseCode: enrollment.section.course.code,
        courseName: enrollment.section.course.name,
        finalGrade: enrollment.finalGrade
          ? Number(enrollment.finalGrade)
          : null,
        letterGrade: enrollment.letterGrade,
        grades,
        calculatedTotal: totalWeight > 0 ? Number(totalScore.toFixed(2)) : null,
        totalWeight: Number(totalWeight),
      };
    });
  }

  async findStudentGradesByLecturer(lecturerId: string, sectionId?: string) {
    const where: any = { lecturerId };
    if (sectionId) {
      where.id = sectionId;
    }

    const sections = await this.prisma.section.findMany({
      where,
      include: { course: true, semester: true },
    });

    const sectionIds = sections.map((s) => s.id);

    const enrollments = await this.prisma.enrollment.findMany({
      where: { sectionId: { in: sectionIds } },
      include: {
        student: { include: { user: true } },
        section: { include: { course: true } },
        gradeItems: {
          include: { gradeItem: true },
        },
      },
    });

    return enrollments.map((enrollment) => ({
      enrollmentId: enrollment.id,
      studentId: enrollment.studentId,
      studentName: enrollment.student.user
        ? `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`
        : '',
      studentNumber: enrollment.student.studentId,
      sectionId: enrollment.sectionId,
      sectionNumber: enrollment.section.sectionNumber,
      courseCode: enrollment.section.course.code,
      courseName: enrollment.section.course.name,
      finalGrade: enrollment.finalGrade ? Number(enrollment.finalGrade) : null,
      letterGrade: enrollment.letterGrade,
      gradeStatus: enrollment.gradeStatus,
      grades: enrollment.gradeItems.map((g) => ({
        id: g.id,
        gradeItemId: g.gradeItemId,
        gradeItemName: g.gradeItem.name,
        gradeItemType: g.gradeItem.type,
        score: g.score ? Number(g.score) : null,
        maxScore: g.gradeItem.maxScore ? Number(g.gradeItem.maxScore) : null,
        weight: g.gradeItem.weight ? Number(g.gradeItem.weight) : null,
      })),
    }));
  }

  async findStudentGradesByEnrollment(enrollmentId: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: {
        student: { include: { user: true } },
        section: { include: { course: true } },
      },
    });

    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    const grades = await this.prisma.studentGrade.findMany({
      where: { enrollmentId },
      include: { gradeItem: true },
    });

    // Calculate total
    let totalScore = 0;
    let totalWeight = 0;
    grades.forEach((g) => {
      if (g.score !== null && g.gradeItem.maxScore && g.gradeItem.weight) {
        totalScore +=
          (Number(g.score) / Number(g.gradeItem.maxScore)) *
          Number(g.gradeItem.weight);
        totalWeight += Number(g.gradeItem.weight);
      }
    });

    return {
      enrollment: {
        id: enrollment.id,
        studentId: enrollment.studentId,
        studentName: enrollment.student.user
          ? `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`
          : '',
        courseCode: enrollment.section.course.code,
        courseName: enrollment.section.course.name,
      },
      grades: grades.map((g) => ({
        id: g.id,
        gradeItemId: g.gradeItemId,
        gradeItemName: g.gradeItem.name,
        gradeItemType: g.gradeItem.type,
        score: g.score ? Number(g.score) : null,
        maxScore: g.gradeItem.maxScore ? Number(g.gradeItem.maxScore) : null,
        weight: g.gradeItem.weight ? Number(g.gradeItem.weight) : null,
      })),
      calculatedTotal: totalWeight > 0 ? Number(totalScore.toFixed(2)) : null,
      totalWeight: Number(totalWeight),
    };
  }

  async findOneStudentGrade(id: string) {
    const studentGrade = await this.prisma.studentGrade.findUnique({
      where: { id },
      include: { gradeItem: true, enrollment: true },
    });
    if (!studentGrade) throw new NotFoundException('Student grade not found');
    return studentGrade;
  }

  async updateStudentGrade(id: string, data: any) {
    await this.findOneStudentGrade(id);
    return this.prisma.studentGrade.update({
      where: { id },
      data,
      include: { gradeItem: true, enrollment: true },
    });
  }

  async removeStudentGrade(id: string) {
    await this.findOneStudentGrade(id);
    await this.prisma.studentGrade.delete({ where: { id } });
    return { message: 'Student grade deleted successfully' };
  }
}
