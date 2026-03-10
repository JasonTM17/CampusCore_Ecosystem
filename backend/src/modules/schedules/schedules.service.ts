import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class SchedulesService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    return this.prisma.schedule.create({ data, include: { section: true, classroom: true } });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [schedules, total] = await Promise.all([
      this.prisma.schedule.findMany({ skip, take: limit, include: { section: true, classroom: true }, orderBy: { dayOfWeek: 'asc' } }),
      this.prisma.schedule.count(),
    ]);
    return { data: schedules, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const schedule = await this.prisma.schedule.findUnique({ where: { id }, include: { section: true, classroom: true } });
    if (!schedule) throw new NotFoundException('Schedule not found');
    return schedule;
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.schedule.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.schedule.delete({ where: { id } });
    return { message: 'Schedule deleted successfully' };
  }
}
