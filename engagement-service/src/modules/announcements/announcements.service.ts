import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../auth/types/auth-user.type';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import {
  ENGAGEMENT_EVENT_TYPES,
  EngagementEventEnvelope,
} from '../rabbitmq/rabbitmq.events';

type AnnouncementRecord = {
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
  semesterName: string | null;
  sectionId: string | null;
  sectionNumber: string | null;
  courseCode: string | null;
  courseName: string | null;
  lecturerId: string | null;
  lecturerDisplayName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  async create(data: CreateAnnouncementDto & { publishedBy: string }) {
    const announcement = await this.prisma.announcement.create({
      data: {
        title: data.title,
        content: data.content,
        priority: data.priority ?? 'NORMAL',
        targetRoles: data.targetRoles ?? [],
        targetYears: data.targetYears ?? [],
        isGlobal: data.isGlobal ?? false,
        publishAt: data.publishAt,
        expiresAt: data.expiresAt,
        publishedBy: data.publishedBy,
        semesterId: data.semesterId ?? null,
        sectionId: data.sectionId ?? null,
        lecturerId: data.lecturerId ?? null,
      },
    });

    await this.publishAnnouncementCreated(announcement);
    return this.mapAnnouncement(announcement);
  }

  async findAll(
    page = 1,
    limit = 20,
    filters?: { semesterId?: string; sectionId?: string; priority?: string },
  ) {
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};

    if (filters?.semesterId) {
      where.semesterId = filters.semesterId;
    }
    if (filters?.sectionId) {
      where.sectionId = filters.sectionId;
    }
    if (filters?.priority) {
      where.priority = filters.priority;
    }

    const [announcements, total] = await Promise.all([
      this.prisma.announcement.findMany({
        skip,
        take: limit,
        where,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.announcement.count({ where }),
    ]);

    return {
      data: announcements.map((announcement) =>
        this.mapAnnouncement(announcement),
      ),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findForUser(user: AuthUser, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const roles = user.roles ?? [];
    const studentYear = user.student?.year ?? null;
    const now = new Date();
    const filters: Array<Record<string, unknown>> = [
      {
        OR: [{ isGlobal: true }, { targetRoles: { hasSome: roles } }],
      },
      {
        OR: [{ publishAt: null }, { publishAt: { lte: now } }],
      },
      {
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    ];

    if (user.studentId && studentYear !== null) {
      filters.push({
        OR: [
          { targetYears: { isEmpty: true } },
          { targetYears: { has: studentYear } },
        ],
      });
    } else if (user.studentId) {
      filters.push({
        OR: [{ targetYears: { isEmpty: true } }],
      });
    }

    if (roles.includes('LECTURER') && user.lecturerId) {
      filters.push({
        OR: [{ lecturerId: null }, { lecturerId: user.lecturerId }],
      });
    }

    const where = { AND: filters };

    const [announcements, total] = await Promise.all([
      this.prisma.announcement.findMany({
        skip,
        take: limit,
        where,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.announcement.count({ where }),
    ]);

    return {
      data: announcements.map((announcement) =>
        this.mapAnnouncement(announcement),
      ),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id },
    });

    if (!announcement) {
      throw new NotFoundException('Announcement not found');
    }

    return this.mapAnnouncement(announcement);
  }

  async update(id: string, data: UpdateAnnouncementDto) {
    await this.findOne(id);
    const updated = await this.prisma.announcement.update({
      where: { id },
      data: {
        ...data,
        publishAt: data.publishAt,
        expiresAt: data.expiresAt,
      },
    });

    return this.mapAnnouncement(updated);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.announcement.delete({ where: { id } });
    return { message: 'Announcement deleted successfully' };
  }

  private mapAnnouncement(announcement: AnnouncementRecord) {
    return {
      ...announcement,
      semester: announcement.semesterName
        ? { name: announcement.semesterName }
        : null,
      section:
        announcement.sectionId ||
        announcement.sectionNumber ||
        announcement.courseCode ||
        announcement.courseName
          ? {
              sectionNumber: announcement.sectionNumber,
              course:
                announcement.courseCode || announcement.courseName
                  ? {
                      code: announcement.courseCode,
                      name: announcement.courseName,
                    }
                  : null,
            }
          : null,
      lecturer: announcement.lecturerId
        ? {
            id: announcement.lecturerId,
            displayName: announcement.lecturerDisplayName,
          }
        : null,
    };
  }

  private async publishAnnouncementCreated(announcement: AnnouncementRecord) {
    const event: EngagementEventEnvelope<{
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
      type: ENGAGEMENT_EVENT_TYPES.ANNOUNCEMENT_CREATED,
      source: 'campuscore-engagement-service',
      occurredAt: new Date().toISOString(),
      payload: {
        announcement: {
          id: announcement.id,
          title: announcement.title,
          content: announcement.content,
          priority: announcement.priority,
          targetRoles: announcement.targetRoles,
          targetYears: announcement.targetYears,
          isGlobal: announcement.isGlobal,
          publishAt: announcement.publishAt?.toISOString() ?? null,
          expiresAt: announcement.expiresAt?.toISOString() ?? null,
          publishedBy: announcement.publishedBy,
          semesterId: announcement.semesterId,
          sectionId: announcement.sectionId,
          lecturerId: announcement.lecturerId,
          createdAt: announcement.createdAt.toISOString(),
          updatedAt: announcement.updatedAt.toISOString(),
        },
      },
    };

    const published = await this.rabbitMQService.publishMessage(event);
    if (!published) {
      this.logger.warn(
        `Announcement ${announcement.id} was created but notification event publish did not complete`,
      );
    }
  }
}
