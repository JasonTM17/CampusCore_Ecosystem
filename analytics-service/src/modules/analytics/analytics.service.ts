import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

const DEFAULT_TREND_MONTHS = 12;
const NEAR_CAPACITY_THRESHOLD = 80;

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
        semesterNameEn: semester.nameEn,
        semesterNameVi: semester.nameVi,
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
      courseNameEn: section.course.nameEn,
      courseNameVi: section.course.nameVi,
      semesterName: section.semester.name,
      semesterNameEn: section.semester.nameEn,
      semesterNameVi: section.semester.nameVi,
      capacity: section.capacity,
      enrolledCount: section._count.enrollments || section.enrolledCount,
      occupancyRate:
        section.capacity > 0
          ? Math.round(
              ((section._count.enrollments || section.enrolledCount) /
                section.capacity) *
                100,
            )
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
      A: 0,
      'A-': 0,
      'B+': 0,
      B: 0,
      'B-': 0,
      'C+': 0,
      C: 0,
      'C-': 0,
      'D+': 0,
      D: 0,
      'D-': 0,
      F: 0,
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

  async getEnrollmentTrends(months = DEFAULT_TREND_MONTHS) {
    const now = new Date();
    const requestedMonths = Number.isFinite(months)
      ? months
      : DEFAULT_TREND_MONTHS;
    const bucketCount = Math.min(Math.max(Math.trunc(requestedMonths), 1), 24);
    const oldestBucket = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - bucketCount + 1, 1),
    );

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        enrolledAt: {
          gte: oldestBucket,
        },
      },
      select: {
        enrolledAt: true,
        status: true,
      },
    });

    const monthlyData: Record<string, EnrollmentTrendBucket> = {};

    for (let i = 0; i < bucketCount; i++) {
      const date = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1),
      );
      const year = date.getUTCFullYear();
      const monthNumber = date.getUTCMonth() + 1;
      const monthKey = `${year}-${String(monthNumber).padStart(2, '0')}`;
      const nextMonth = new Date(Date.UTC(year, monthNumber, 1));
      monthlyData[monthKey] = {
        month: monthKey,
        year,
        monthNumber,
        startDate: date.toISOString(),
        endDate: new Date(nextMonth.getTime() - 1).toISOString(),
        labelEn: new Intl.DateTimeFormat('en-US', {
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(date),
        labelVi: new Intl.DateTimeFormat('vi-VN', {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(date),
        enrolled: 0,
        dropped: 0,
        completed: 0,
        net: 0,
        totalActivity: 0,
      };
    }

    enrollments.forEach((e) => {
      const monthKey = `${e.enrolledAt.getUTCFullYear()}-${String(e.enrolledAt.getUTCMonth() + 1).padStart(2, '0')}`;
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

    return Object.values(monthlyData)
      .reverse()
      .map((bucket) => ({
        ...bucket,
        net: bucket.enrolled + bucket.completed - bucket.dropped,
        totalActivity: bucket.enrolled + bucket.completed + bucket.dropped,
      }));
  }

  async getFinanceSummary() {
    const [invoicesByStatus, paymentsByStatus, paymentsByMethod] =
      await Promise.all([
        this.prisma.invoice.groupBy({
          by: ['status'],
          _count: { id: true },
          _sum: { total: true },
        }),
        this.prisma.payment.groupBy({
          by: ['status'],
          _count: { id: true },
          _sum: { amount: true },
        }),
        this.prisma.payment.groupBy({
          by: ['method', 'status'],
          _count: { id: true },
          _sum: { amount: true },
        }),
      ]);

    const totalInvoiced = invoicesByStatus.reduce(
      (sum, item) => sum + Number(item._sum.total ?? 0),
      0,
    );
    const paidAmount = paymentsByStatus
      .filter((item) => item.status === 'COMPLETED')
      .reduce((sum, item) => sum + Number(item._sum.amount ?? 0), 0);
    const failedPayments = paymentsByStatus
      .filter((item) => item.status === 'FAILED')
      .reduce((sum, item) => sum + item._count.id, 0);
    const pendingInvoices = invoicesByStatus
      .filter((item) => item.status === 'PENDING')
      .reduce((sum, item) => sum + item._count.id, 0);
    const overdueInvoices = invoicesByStatus
      .filter((item) => item.status === 'OVERDUE')
      .reduce((sum, item) => sum + item._count.id, 0);

    return {
      totals: {
        totalInvoiced,
        paidAmount,
        outstandingAmount: Math.max(totalInvoiced - paidAmount, 0),
        pendingInvoices,
        overdueInvoices,
        failedPayments,
      },
      invoiceStatus: invoicesByStatus.map((item) => ({
        status: item.status,
        count: item._count.id,
        amount: Number(item._sum.total ?? 0),
      })),
      paymentStatus: paymentsByStatus.map((item) => ({
        status: item.status,
        count: item._count.id,
        amount: Number(item._sum.amount ?? 0),
      })),
      providerFunnel: paymentsByMethod.map((item) => ({
        provider: item.method,
        status: item.status,
        count: item._count.id,
        amount: Number(item._sum.amount ?? 0),
      })),
    };
  }

  async getNotificationSummary() {
    const [total, unread, byType, recentFailures] = await Promise.all([
      this.prisma.notification.count(),
      this.prisma.notification.count({ where: { isRead: false } }),
      this.prisma.notification.groupBy({
        by: ['type'],
        _count: { id: true },
      }),
      this.prisma.notification.findMany({
        where: { type: { in: ['ERROR', 'WARNING'] } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          title: true,
          message: true,
          type: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      total,
      unread,
      read: Math.max(total - unread, 0),
      byType: byType.map((item) => ({
        type: item.type,
        count: item._count.id,
      })),
      recentAttention: recentFailures.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  async getRegistrationPressure() {
    const [sections, waitlists, activeSemesters] = await Promise.all([
      this.prisma.section.findMany({
        include: {
          course: true,
          semester: true,
          _count: {
            select: {
              enrollments: {
                where: { status: { in: ['CONFIRMED', 'PENDING'] } },
              },
              waitlists: {
                where: { status: 'ACTIVE' },
              },
            },
          },
        },
      }),
      this.prisma.waitlist.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      this.prisma.semester.count({
        where: { status: { in: ['REGISTRATION_OPEN', 'ADD_DROP_OPEN'] } },
      }),
    ]);

    const enriched = sections.map((section) => {
      const enrolledCount = section._count.enrollments || section.enrolledCount;
      const occupancyRate =
        section.capacity > 0
          ? Math.round((enrolledCount / section.capacity) * 100)
          : 0;
      return {
        sectionId: section.id,
        sectionNumber: section.sectionNumber,
        courseCode: section.course.code,
        courseName: section.course.name,
        courseNameEn: section.course.nameEn,
        courseNameVi: section.course.nameVi,
        semesterName: section.semester.name,
        semesterNameEn: section.semester.nameEn,
        semesterNameVi: section.semester.nameVi,
        capacity: section.capacity,
        enrolledCount,
        waitlistCount: section._count.waitlists,
        occupancyRate,
      };
    });

    const atCapacity = enriched.filter(
      (section) => section.occupancyRate >= 100,
    );
    const nearCapacity = enriched.filter(
      (section) =>
        section.occupancyRate >= NEAR_CAPACITY_THRESHOLD &&
        section.occupancyRate < 100,
    );
    const waitlistActive = waitlists
      .filter((item) => item.status === 'ACTIVE')
      .reduce((sum, item) => sum + item._count.id, 0);
    const averageOccupancy =
      enriched.length > 0
        ? Math.round(
            enriched.reduce((sum, section) => sum + section.occupancyRate, 0) /
              enriched.length,
          )
        : 0;

    return {
      activeSemesters,
      totalSections: enriched.length,
      atCapacity: atCapacity.length,
      nearCapacity: nearCapacity.length,
      waitlistActive,
      averageOccupancy,
      highestPressure: enriched
        .sort((a, b) => {
          if (b.occupancyRate !== a.occupancyRate) {
            return b.occupancyRate - a.occupancyRate;
          }
          return b.waitlistCount - a.waitlistCount;
        })
        .slice(0, 8),
      waitlistStatus: waitlists.map((item) => ({
        status: item.status,
        count: item._count.id,
      })),
    };
  }

  async getOperatorSummary() {
    const [serviceCount, dependencyDown, highLatency] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT 8::bigint AS count`,
      this.prisma.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT 0::bigint AS count`,
      this.prisma.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT 0::bigint AS count`,
    ]);

    return {
      generatedAt: new Date().toISOString(),
      serviceCount: Number(serviceCount[0]?.count ?? 8),
      dependencyDown: Number(dependencyDown[0]?.count ?? 0),
      highLatency: Number(highLatency[0]?.count ?? 0),
      dashboards: [
        { label: 'Grafana', url: 'http://127.0.0.1:3002' },
        { label: 'Prometheus', url: 'http://127.0.0.1:9090' },
        { label: 'Loki', url: 'http://127.0.0.1:3100' },
        { label: 'Tempo', url: 'http://127.0.0.1:3200' },
      ],
    };
  }

  async getCockpit() {
    const [
      overview,
      enrollmentTrends,
      sectionOccupancy,
      gradeDistribution,
      finance,
      notifications,
      registrationPressure,
      operator,
    ] = await Promise.all([
      this.getOverview(),
      this.getEnrollmentTrends(DEFAULT_TREND_MONTHS),
      this.getSectionOccupancy(),
      this.getGradeDistribution(),
      this.getFinanceSummary(),
      this.getNotificationSummary(),
      this.getRegistrationPressure(),
      this.getOperatorSummary(),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      overview,
      enrollmentTrends,
      sectionOccupancy,
      gradeDistribution,
      finance,
      notifications,
      registrationPressure,
      operator,
    };
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

    const totalInvoiced = invoices.reduce(
      (sum, inv) => sum + Number(inv.total),
      0,
    );
    const totalPaid = payments
      .filter((p) => p.status === 'COMPLETED')
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const pending = totalInvoiced - totalPaid;

    return {
      totalInvoiced: Number(totalInvoiced.toFixed(2)),
      totalPaid: Number(totalPaid.toFixed(2)),
      pending: Number(pending.toFixed(2)),
      invoiceCount: invoices.length,
      paidInvoiceCount: invoices.filter((i) => i.status === 'PAID').length,
      pendingInvoiceCount: invoices.filter((i) => i.status !== 'PAID').length,
    };
  }

  async getAttendanceAnalytics(semesterId?: string) {
    const where: any = {};
    if (semesterId) {
      where.section = { semesterId };
    }

    const attendances = await this.prisma.attendance.findMany({ where });

    const total = attendances.length;
    const present = attendances.filter((a) => a.status === 'PRESENT').length;
    const absent = attendances.filter((a) => a.status === 'ABSENT').length;
    const late = attendances.filter((a) => a.status === 'LATE').length;
    const excused = attendances.filter((a) => a.status === 'EXCUSED').length;

    return {
      totalRecords: total,
      present,
      absent,
      late,
      excused,
      attendanceRate:
        total > 0 ? Math.round(((present + late) / total) * 100) : 0,
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

    const courseStats = courses.map((course) => {
      const totalEnrollments = course.sections.reduce(
        (sum, s) => sum + (s._count.enrollments || 0),
        0,
      );
      return {
        courseId: course.id,
        courseCode: course.code,
        courseName: course.name,
        courseNameEn: course.nameEn,
        courseNameVi: course.nameVi,
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
      byYear: byYear.map((y) => ({ year: y.year, count: y._count.id })),
    };
  }

  async getLecturerAnalytics(lecturerId: string) {
    const [totalSections, totalStudents, sectionsWithGrades] =
      await Promise.all([
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

    return sections.map((section) => ({
      sectionId: section.id,
      sectionNumber: section.sectionNumber,
      courseCode: section.course.code,
      courseName: section.course.name,
      courseNameEn: section.course.nameEn,
      courseNameVi: section.course.nameVi,
      semesterName: section.semester.name,
      semesterNameEn: section.semester.nameEn,
      semesterNameVi: section.semester.nameVi,
      capacity: section.capacity,
      enrolledCount: section._count.enrollments || section.enrolledCount,
      occupancyRate:
        section.capacity > 0
          ? Math.round(
              ((section._count.enrollments || section.enrolledCount) /
                section.capacity) *
                100,
            )
          : 0,
    }));
  }
}

type EnrollmentTrendBucket = {
  month: string;
  year: number;
  monthNumber: number;
  startDate: string;
  endDate: string;
  labelEn: string;
  labelVi: string;
  enrolled: number;
  dropped: number;
  completed: number;
  net: number;
  totalActivity: number;
};
