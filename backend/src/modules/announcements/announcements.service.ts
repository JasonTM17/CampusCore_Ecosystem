import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class AnnouncementsService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    return this.prisma.announcement.create({ data, include: { semester: true, section: true, lecturer: true } });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [announcements, total] = await Promise.all([
      this.prisma.announcement.findMany({ skip, take: limit, include: { semester: true, section: true, lecturer: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.announcement.count(),
    ]);
    return { data: announcements, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const announcement = await this.prisma.announcement.findUnique({ where: { id }, include: { semester: true, section: true, lecturer: true } });
    if (!announcement) throw new NotFoundException('Announcement not found');
    return announcement;
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.announcement.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.announcement.delete({ where: { id } });
    return { message: 'Announcement deleted successfully' };
  }
}
