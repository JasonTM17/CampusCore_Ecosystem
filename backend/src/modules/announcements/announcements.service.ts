import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../auth/types/auth-user.type';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import {
  NOTIFICATION_EVENTS_QUEUE,
  NOTIFICATION_EVENT_TYPES,
  NotificationEventEnvelope,
} from '../rabbitmq/notification-events';

@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);

  constructor(
    private prisma: PrismaService,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  async create(data: CreateAnnouncementDto) {
    const announcement = await this.prisma.announcement.create({
      data,
      include: { semester: true, section: true, lecturer: true },
    });

    await this.publishAnnouncementCreated(announcement);

    return announcement;
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

  private async publishAnnouncementCreated(announcement: {
    id: string;
    title: string;
    content: string;
    priority: string;
    targetRoles: string[];
    targetYears: number[];
    isGlobal: boolean;
    publishAt: Date | null;
    expiresAt: Date | null;
    publishedBy: string | null;
    semesterId: string | null;
    sectionId: string | null;
    lecturerId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const event: NotificationEventEnvelope<{
      announcement: {
        id: string;
        title: string;
        content: string;
        priority: string;
        targetRoles: string[];
        targetYears: number[];
        isGlobal: boolean;
        publishAt: string | null;
        expiresAt: string | null;
        publishedBy: string | null;
        semesterId: string | null;
        sectionId: string | null;
        lecturerId: string | null;
        createdAt: string;
        updatedAt: string;
      };
    }> = {
      type: NOTIFICATION_EVENT_TYPES.ANNOUNCEMENT_CREATED,
      source: 'campuscore-core-api',
      occurredAt: new Date().toISOString(),
      payload: {
        announcement: {
          ...announcement,
          publishAt: announcement.publishAt?.toISOString() ?? null,
          expiresAt: announcement.expiresAt?.toISOString() ?? null,
          createdAt: announcement.createdAt.toISOString(),
          updatedAt: announcement.updatedAt.toISOString(),
        },
      },
    };

    const published = await this.rabbitMQService.publishMessage(
      NOTIFICATION_EVENTS_QUEUE,
      event,
    );

    if (!published) {
      this.logger.warn(
        `Announcement ${announcement.id} was created but notification event publish did not complete`,
      );
    }
  }
}
