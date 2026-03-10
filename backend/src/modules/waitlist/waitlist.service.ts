import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class WaitlistService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    return this.prisma.waitlist.create({ data, include: { student: true, section: true } });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [waitlist, total] = await Promise.all([
      this.prisma.waitlist.findMany({ skip, take: limit, include: { student: true, section: true }, orderBy: { position: 'asc' } }),
      this.prisma.waitlist.count(),
    ]);
    return { data: waitlist, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const entry = await this.prisma.waitlist.findUnique({ where: { id }, include: { student: true, section: true } });
    if (!entry) throw new NotFoundException('Waitlist entry not found');
    return entry;
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.waitlist.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.waitlist.delete({ where: { id } });
    return { message: 'Waitlist entry removed successfully' };
  }
}
