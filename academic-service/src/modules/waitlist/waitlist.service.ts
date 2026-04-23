import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { WaitlistStatus } from '@prisma/client';
import { EnrollmentsService } from '../enrollments/enrollments.service';

@Injectable()
export class WaitlistService {
  constructor(
    private prisma: PrismaService,
    private enrollmentsService: EnrollmentsService,
  ) {}

  async findAll(page = 1, limit = 20, sectionId?: string) {
    const skip = (page - 1) * limit;
    const where = sectionId ? { sectionId } : {};

    const [waitlist, total] = await Promise.all([
      this.prisma.waitlist.findMany({
        where,
        skip,
        take: limit,
        include: {
          student: { include: { user: true } },
          section: { include: { course: true } },
        },
        orderBy: { position: 'asc' },
      }),
      this.prisma.waitlist.count({ where }),
    ]);
    return {
      data: waitlist,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const entry = await this.prisma.waitlist.findUnique({
      where: { id },
      include: {
        student: { include: { user: true } },
        section: { include: { course: true } },
      },
    });
    if (!entry) throw new NotFoundException('Waitlist entry not found');
    return entry;
  }

  async findBySection(sectionId: string) {
    return this.prisma.waitlist.findMany({
      where: { sectionId, status: WaitlistStatus.ACTIVE },
      include: { student: { include: { user: true } } },
      orderBy: { position: 'asc' },
    });
  }

  async findByStudent(studentId: string) {
    return this.prisma.waitlist.findMany({
      where: {
        studentId,
        status: WaitlistStatus.ACTIVE,
      },
      include: {
        section: {
          include: {
            course: {
              include: {
                department: true,
              },
            },
            semester: true,
            schedules: {
              include: {
                classroom: true,
              },
            },
          },
        },
      },
      orderBy: [{ addedAt: 'desc' }, { position: 'asc' }],
    });
  }

  async remove(id: string, studentId?: string) {
    return this.enrollmentsService.removeWaitlistEntry(id, studentId);
  }

  async promoteStudent(waitlistEntryId: string) {
    return this.enrollmentsService.promoteWaitlistEntry(waitlistEntryId);
  }
}
