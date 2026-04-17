import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../auth/types/auth-user.type';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

@Injectable()
export class AnnouncementsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateAnnouncementDto) {
    return this.prisma.announcement.create({
      data,
      include: { semester: true, section: true, lecturer: true },
    });
  }

  async findAll(
    page = 1,
    limit = 20,
    filters?: { semesterId?: string; sectionId?: string; priority?: string },
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (filters?.semesterId) where.semesterId = filters.semesterId;
    if (filters?.sectionId) where.sectionId = filters.sectionId;
    if (filters?.priority) where.priority = filters.priority;

    const [announcements, total] = await Promise.all([
      this.prisma.announcement.findMany({
        skip,
        take: limit,
        where,
        include: {
          semester: true,
          section: true,
          lecturer: { include: { user: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.announcement.count({ where }),
    ]);
    return {
      data: announcements,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findForUser(user: AuthUser, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const roles: string[] = user?.roles || [];
    const studentYear: number | null = user?.student?.year ?? null;
    const lecturerId: string | null = user?.lecturerId ?? null;
    const now = new Date();

    const where: any = {
      AND: [
        {
          OR: [{ isGlobal: true }, { targetRoles: { hasSome: roles } }],
        },
        {
          OR: [{ publishAt: null }, { publishAt: { lte: now } }],
        },
        {
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      ],
    };

    // Student-year targeting (if targetYears specified, user must match)
    if (studentYear !== null) {
      where.AND.push({
        OR: [
          { targetYears: { isEmpty: true } },
          { targetYears: { has: studentYear } },
        ],
      });
    }

    // If announcement is tied to a lecturer, only that lecturer should see it (unless global/role-targeted without lecturerId)
    if (roles.includes('LECTURER') && lecturerId) {
      where.AND.push({
        OR: [{ lecturerId: null }, { lecturerId }],
      });
    }

    const [announcements, total] = await Promise.all([
      this.prisma.announcement.findMany({
        skip,
        take: limit,
        where,
        include: {
          semester: true,
          section: { include: { course: true } },
          lecturer: { include: { user: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.announcement.count({ where }),
    ]);

    return {
      data: announcements,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id },
      include: { semester: true, section: true, lecturer: true },
    });
    if (!announcement) throw new NotFoundException('Announcement not found');
    return announcement;
  }

  async update(id: string, data: UpdateAnnouncementDto) {
    await this.findOne(id);
    return this.prisma.announcement.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.announcement.delete({ where: { id } });
    return { message: 'Announcement deleted successfully' };
  }
}
