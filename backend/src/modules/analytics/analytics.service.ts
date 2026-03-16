import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getOverview() {
    const [
      totalStudents,
      totalLecturers,
      totalCourses,
      totalSections,
      totalEnrollments,
      totalDepartments,
      totalFaculties,
      totalAcademicYears,
      totalSemesters,
      totalClassrooms,
    ] = await Promise.all([
      this.prisma.student.count(),
      this.prisma.lecturer.count(),
      this.prisma.course.count(),
      this.prisma.section.count(),
      this.prisma.enrollment.count(),
      this.prisma.department.count(),
      this.prisma.faculty.count(),
      this.prisma.academicYear.count(),
      this.prisma.semester.count(),
      this.prisma.classroom.count(),
    ]);

    return {
      totalStudents,
      totalLecturers,
      totalCourses,
      totalSections,
      totalEnrollments,
      totalDepartments,
      totalFaculties,
      totalAcademicYears,
      totalSemesters,
      totalClassrooms,
    };
  }

  async getEnrollmentsBySemester() {
    const enrollments = await this.prisma.enrollment.groupBy({
      by: ['semesterId'],
      _count: {
        id: true,
      },
      where: {
        status: { in: ['CONFIRMED', 'COMPLETED'] },
      },
    });

    const semesterData = await this.prisma.semester.findMany({
      where: { id: { in: enrollments.map((e) => e.semesterId) } },
      include: { academicYear: true },
      orderBy: { startDate: 'desc' },
      take: 10,
    });

    const result = semesterData.map((semester) => {
      const enrollment = enrollments.find((e) => e.semesterId === semester.id);
      return {
        semesterId: semester.id,
        semesterName: semester.name,
        academicYear: semester.academicYear.year,
        enrollmentCount: enrollment?._count.id || 0,
      };
    });

    return result;
  }

  async getSectionOccupancy() {
    const sections = await this.prisma.section.findMany({
      include: {
        course: true,
        semester: { include: { academicYear: true } },
        _count: {
          select: {
            enrollments: {
              where: { status: { in: ['CONFIRMED', 'PENDING'] } },
            },
          },
        },
      },
      take: 20,
      orderBy: { enrolledCount: 'desc' },
    });

    return sections.map((section) => ({
      sectionId: section.id,
      sectionNumber: section.sectionNumber,
      courseCode: section.course.code,
      courseName: section.course.name,
      semesterName: section.semester.name,
      capacity: section.capacity,
      enrolledCount: section._count.enrollments || section.enrolledCount,
      occupancyRate: section.capacity > 0 
        ? Math.round(((section._count.enrollments || section.enrolledCount) / section.capacity) * 100) 
        : 0,
    }));
  }

  async getGradeDistribution() {
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        status: 'COMPLETED',
        letterGrade: { not: null },
      },
      select: {
        letterGrade: true,
      },
    });

    const distribution: Record<string, number> = {
      'A': 0,
      'A-': 0,
      'B+': 0,
      'B': 0,
      'B-': 0,
      'C+': 0,
      'C': 0,
      'C-': 0,
      'D+': 0,
      'D': 0,
      'D-': 0,
      'F': 0,
    };

    enrollments.forEach((e) => {
      if (e.letterGrade && distribution.hasOwnProperty(e.letterGrade)) {
        distribution[e.letterGrade]++;
      }
    });

    const total = enrollments.length;
    const result = Object.entries(distribution).map(([grade, count]) => ({
      grade,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
    }));

    return result;
  }

  async getEnrollmentTrends() {
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        enrolledAt: {
          gte: sixMonthsAgo,
        },
      },
      select: {
        enrolledAt: true,
        status: true,
      },
    });

    const monthlyData: Record<string, { month: string; enrolled: number; dropped: number; completed: number }> = {};

    for (let i = 0; i < 6; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthlyData[monthKey] = {
        month: monthKey,
        enrolled: 0,
        dropped: 0,
        completed: 0,
      };
    }

    enrollments.forEach((e) => {
      const monthKey = `${e.enrolledAt.getFullYear()}-${String(e.enrolledAt.getMonth() + 1).padStart(2, '0')}`;
      if (monthlyData[monthKey]) {
        if (e.status === 'CONFIRMED' || e.status === 'PENDING') {
          monthlyData[monthKey].enrolled++;
        } else if (e.status === 'DROPPED') {
          monthlyData[monthKey].dropped++;
        } else if (e.status === 'COMPLETED') {
          monthlyData[monthKey].completed++;
        }
      }
    });

    return Object.values(monthlyData).reverse();
  }

  async getRevenueAnalytics(semesterId?: string) {
    const where: any = {};
    if (semesterId) where.semesterId = semesterId;

    const [invoices, payments] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: { semester: true },
      }),
      this.prisma.payment.findMany({
        where: semesterId ? { invoice: { semesterId } } : undefined,
        include: { invoice: true },
      }),
    ]);

    const totalInvoiced = invoices.reduce((sum, inv) => sum + Number(inv.total), 0);
    const totalPaid = payments
      .filter(p => p.status === 'COMPLETED')
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const pending = totalInvoiced - totalPaid;

    return {
      totalInvoiced: Number(totalInvoiced.toFixed(2)),
      totalPaid: Number(totalPaid.toFixed(2)),
      pending: Number(pending.toFixed(2)),
      invoiceCount: invoices.length,
      paidInvoiceCount: invoices.filter(i => i.status === 'PAID').length,
      pendingInvoiceCount: invoices.filter(i => i.status !== 'PAID').length,
    };
  }

  async getAttendanceAnalytics(semesterId?: string) {
    const where: any = {};
    if (semesterId) {
      where.section = { semesterId };
    }

    const attendances = await this.prisma.attendance.findMany({ where });

    const total = attendances.length;
    const present = attendances.filter(a => a.status === 'PRESENT').length;
    const absent = attendances.filter(a => a.status === 'ABSENT').length;
    const late = attendances.filter(a => a.status === 'LATE').length;
    const excused = attendances.filter(a => a.status === 'EXCUSED').length;

    return {
      totalRecords: total,
      present,
      absent,
      late,
      excused,
      attendanceRate: total > 0 ? Math.round(((present + late) / total) * 100) : 0,
    };
  }

  async getTopCourses(limit = 10) {
    const courses = await this.prisma.course.findMany({
      include: {
        _count: {
          select: { sections: true },
        },
        sections: {
          include: {
            _count: {
              select: {
                enrollments: {
                  where: { status: { in: ['CONFIRMED', 'PENDING'] } },
                },
              },
            },
          },
        },
      },
    });

    const courseStats = courses.map(course => {
      const totalEnrollments = course.sections.reduce(
        (sum, s) => sum + (s._count.enrollments || 0),
        0
      );
      return {
        courseId: course.id,
        courseCode: course.code,
        courseName: course.name,
        credits: course.credits,
        sectionCount: course._count.sections,
        totalEnrollments,
      };
    });

    return courseStats
      .sort((a, b) => b.totalEnrollments - a.totalEnrollments)
      .slice(0, limit);
  }

  async getStudentStatistics() {
    const [
      totalStudents,
      activeStudents,
      graduatedStudents,
      suspendedStudents,
      byYear,
    ] = await Promise.all([
      this.prisma.student.count(),
      this.prisma.student.count({ where: { status: 'ACTIVE' } }),
      this.prisma.student.count({ where: { status: 'GRADUATED' } }),
      this.prisma.student.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.student.groupBy({
        by: ['year'],
        _count: { id: true },
      }),
    ]);

    return {
      total: totalStudents,
      active: activeStudents,
      graduated: graduatedStudents,
      suspended: suspendedStudents,
      byYear: byYear.map(y => ({ year: y.year, count: y._count.id })),
    };
  }

  async getLecturerAnalytics(lecturerId: string) {
    const [
      totalSections,
      totalStudents,
      sectionsWithGrades,
    ] = await Promise.all([
      this.prisma.section.count({ where: { lecturerId } }),
      this.prisma.enrollment.count({
        where: {
          section: { lecturerId },
          status: { in: ['CONFIRMED', 'PENDING'] },
        },
      }),
      this.prisma.enrollment.count({
        where: {
          section: { lecturerId },
          gradeStatus: 'PUBLISHED',
        },
      }),
    ]);

    return {
      totalSections,
      totalStudents,
      sectionsWithGrades,
    };
  }

  async getLecturerSectionAnalytics(lecturerId: string) {
    const sections = await this.prisma.section.findMany({
      where: { lecturerId },
      include: {
        course: true,
        semester: true,
        _count: {
          select: {
            enrollments: {
              where: { status: { in: ['CONFIRMED', 'PENDING'] } },
            },
          },
        },
      },
    });

    return sections.map(section => ({
      sectionId: section.id,
      sectionNumber: section.sectionNumber,
      courseCode: section.course.code,
      courseName: section.course.name,
      semesterName: section.semester.name,
      capacity: section.capacity,
      enrolledCount: section._count.enrollments || section.enrolledCount,
      occupancyRate: section.capacity > 0
        ? Math.round(((section._count.enrollments || section.enrolledCount) / section.capacity) * 100)
        : 0,
    }));
  }
}
