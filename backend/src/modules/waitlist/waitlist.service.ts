import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { EnrollmentStatus, WaitlistStatus } from '@prisma/client';

@Injectable()
export class WaitlistService {
  constructor(private prisma: PrismaService) {}

  async findAll(page = 1, limit = 20, sectionId?: string) {
    const skip = (page - 1) * limit;
    const where = sectionId ? { sectionId } : {};

    const [waitlist, total] = await Promise.all([
      this.prisma.waitlist.findMany({
        where,
        skip,
        take: limit,
        include: { student: { include: { user: true } }, section: { include: { course: true } } },
        orderBy: { position: 'asc' },
      }),
      this.prisma.waitlist.count({ where }),
    ]);
    return { data: waitlist, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const entry = await this.prisma.waitlist.findUnique({
      where: { id },
      include: { student: { include: { user: true } }, section: { include: { course: true } } },
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

  async remove(id: string) {
    const entry = await this.prisma.waitlist.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Waitlist entry not found');

    await this.prisma.waitlist.delete({ where: { id } });

    // Update positions
    const remaining = await this.prisma.waitlist.findMany({
      where: { sectionId: entry.sectionId, status: WaitlistStatus.ACTIVE },
      orderBy: { position: 'asc' },
    });

    for (let i = 0; i < remaining.length; i++) {
      await this.prisma.waitlist.update({
        where: { id: remaining[i].id },
        data: { position: i + 1 },
      });
    }

    return { message: 'Waitlist entry removed successfully' };
  }

  async promoteStudent(waitlistEntryId: string) {
    const entry = await this.prisma.waitlist.findUnique({
      where: { id: waitlistEntryId },
      include: { section: true },
    });

    if (!entry) {
      throw new NotFoundException('Waitlist entry not found');
    }

    // Create enrollment for the promoted student
    await this.prisma.enrollment.create({
      data: {
        studentId: entry.studentId,
        sectionId: entry.sectionId,
        semesterId: entry.section.semesterId,
        status: EnrollmentStatus.PENDING,
      },
    });

    // Update waitlist entry
    await this.prisma.waitlist.update({
      where: { id: waitlistEntryId },
      data: { status: WaitlistStatus.CONVERTED, convertedAt: new Date() },
    });

    // Update remaining positions
    const remaining = await this.prisma.waitlist.findMany({
      where: { sectionId: entry.sectionId, status: WaitlistStatus.ACTIVE },
      orderBy: { position: 'asc' },
    });

    for (let i = 0; i < remaining.length; i++) {
      await this.prisma.waitlist.update({
        where: { id: remaining[i].id },
        data: { position: i + 1 },
      });
    }

    return { message: 'Student promoted from waitlist' };
  }
}
