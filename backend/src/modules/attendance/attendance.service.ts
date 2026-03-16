import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService) {}

  // ============ CREATE ============

  async create(data: any) {
    return this.prisma.attendance.create({ data, include: { student: true, section: true } });
  }

  async createBulk(records: any[]) {
    const results = await this.prisma.attendance.createManyAndReturn({
      data: records,
    });
    return results;
  }

  async findAll(page = 1, limit = 20, sectionId?: string, studentId?: string, date?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (sectionId) where.sectionId = sectionId;
    if (studentId) where.studentId = studentId;
    if (date) where.date = new Date(date);

    const [records, total] = await Promise.all([
      this.prisma.attendance.findMany({
        skip,
        take: limit,
        where,
        include: { student: { include: { user: true } }, section: { include: { course: true } } },
        orderBy: { date: 'desc' },
      }),
      this.prisma.attendance.count({ where }),
    ]);
    return { data: records, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  // ============ STUDENT METHODS ============

  async getStudentAttendance(studentId: string, sectionId?: string, semesterId?: string) {
    const where: any = { studentId };

    if (sectionId) {
      where.sectionId = sectionId;
    } else if (semesterId) {
      where.section = { semesterId };
    }

    return this.prisma.attendance.findMany({
      where,
      include: {
        section: { include: { course: true } },
      },
      orderBy: { date: 'desc' },
    });
  }

  async getStudentAttendanceSummary(studentId: string, semesterId?: string) {
    const where: any = { studentId };
    if (semesterId) {
      where.section = { semesterId };
    }

    const attendances = await this.prisma.attendance.findMany({
      where,
      include: { section: { include: { course: true } } },
    });

    // Group by section
    const sectionMap = new Map<string, any>();
    attendances.forEach(a => {
      if (!sectionMap.has(a.sectionId)) {
        sectionMap.set(a.sectionId, {
          sectionId: a.sectionId,
          courseCode: a.section.course.code,
          courseName: a.section.course.name,
          total: 0,
          present: 0,
          absent: 0,
          late: 0,
          excused: 0,
        });
      }
      const stats = sectionMap.get(a.sectionId);
      stats.total++;
      if (a.status === 'PRESENT') stats.present++;
      else if (a.status === 'ABSENT') stats.absent++;
      else if (a.status === 'LATE') stats.late++;
      else if (a.status === 'EXCUSED') stats.excused++;
    });

    return Array.from(sectionMap.values()).map(s => ({
      ...s,
      attendanceRate: s.total > 0 ? Math.round((s.present / s.total) * 100) : 0,
    }));
  }

  // ============ LECTURER METHODS ============

  async getSectionAttendanceByLecturer(lecturerId: string, sectionId?: string, date?: string) {
    const where: any = {};

    // Get sections for this lecturer
    const sections = await this.prisma.section.findMany({
      where: { lecturerId, ...(sectionId ? { id: sectionId } : {}) },
      select: { id: true },
    });
    const sectionIds = sections.map(s => s.id);

    where.sectionId = { in: sectionIds };
    if (date) where.date = new Date(date);

    return this.prisma.attendance.findMany({
      where,
      include: {
        student: { include: { user: true } },
        section: { include: { course: true } },
      },
      orderBy: [{ date: 'desc' }, { student: { user: { firstName: 'asc' } } }],
    });
  }

  async getSectionAttendance(sectionId: string, date?: string) {
    const where: any = { sectionId };
    if (date) where.date = new Date(date);

    return this.prisma.attendance.findMany({
      where,
      include: {
        student: { include: { user: true } },
      },
      orderBy: { student: { user: { firstName: 'asc' } } },
    });
  }

  async getSectionAttendanceSummary(sectionId: string) {
    const attendances = await this.prisma.attendance.findMany({
      where: { sectionId },
    });

    const total = attendances.length;
    const present = attendances.filter(a => a.status === 'PRESENT').length;
    const absent = attendances.filter(a => a.status === 'ABSENT').length;
    const late = attendances.filter(a => a.status === 'LATE').length;
    const excused = attendances.filter(a => a.status === 'EXCUSED').length;

    // Get unique dates
    const uniqueDates = new Set(attendances.map(a => a.date.toISOString().split('T')[0]));

    return {
      sectionId,
      totalSessions: uniqueDates.size,
      totalRecords: total,
      present,
      absent,
      late,
      excused,
      attendanceRate: total > 0 ? Math.round(((present + late) / total) * 100) : 0,
    };
  }

  async markSectionAttendance(
    lecturerId: string,
    sectionId: string,
    date: string,
    records: { studentId: string; status: string; notes?: string }[]
  ) {
    // Verify lecturer owns this section
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, lecturerId },
    });

    if (!section) {
      throw new ForbiddenException('You are not authorized to mark attendance for this section');
    }

    const attendanceDate = new Date(date);

    // Delete existing records for this date and section
    await this.prisma.attendance.deleteMany({
      where: { sectionId, date: attendanceDate },
    });

    // Create new records
    const createData = records.map(r => ({
      studentId: r.studentId,
      sectionId,
      date: attendanceDate,
      status: r.status as any,
      notes: r.notes,
    }));

    const result = await this.prisma.attendance.createManyAndReturn({
      data: createData,
    });

    return {
      message: `Attendance marked for ${result.length} students`,
      date,
      sectionId,
      count: result.length,
    };
  }

  // ============ COMMON METHODS ============

  async findOne(id: string) {
    const record = await this.prisma.attendance.findUnique({
      where: { id },
      include: { student: { include: { user: true } }, section: { include: { course: true } } },
    });
    if (!record) throw new NotFoundException('Attendance record not found');
    return record;
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.attendance.update({ where: { id }, data, include: { student: true, section: true } });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.attendance.delete({ where: { id } });
    return { message: 'Attendance record deleted successfully' };
  }
}
