import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class GradesService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    return this.prisma.grade.create({ data, include: { enrollment: true } });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [grades, total] = await Promise.all([
      this.prisma.grade.findMany({ skip, take: limit, include: { enrollment: { include: { student: true, section: true } } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.grade.count(),
    ]);
    return { data: grades, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const grade = await this.prisma.grade.findUnique({ where: { id }, include: { enrollment: { include: { student: true, section: true } } } });
    if (!grade) throw new NotFoundException('Grade not found');
    return grade;
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.grade.update({ where: { id }, data, include: { enrollment: true } });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.grade.delete({ where: { id } });
    return { message: 'Grade deleted successfully' };
  }
}
