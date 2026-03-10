import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    return this.prisma.notification.create({ data, include: { user: true } });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({ skip, take: limit, include: { user: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.notification.count(),
    ]);
    return { data: notifications, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id }, include: { user: true } });
    if (!notification) throw new NotFoundException('Notification not found');
    return notification;
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.notification.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.notification.delete({ where: { id } });
    return { message: 'Notification deleted successfully' };
  }
}
