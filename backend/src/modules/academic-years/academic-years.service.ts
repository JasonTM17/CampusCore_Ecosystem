import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class AcademicYearsService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    return this.prisma.academicYear.create({ data, include: { semesters: true } });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [years, total] = await Promise.all([
      this.prisma.academicYear.findMany({ skip, take: limit, include: { semesters: true }, orderBy: { startDate: 'desc' } }),
      this.prisma.academicYear.count(),
    ]);
    return { data: years, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const year = await this.prisma.academicYear.findUnique({ where: { id }, include: { semesters: true } });
    if (!year) throw new NotFoundException('Academic year not found');
    return year;
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.academicYear.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.academicYear.delete({ where: { id } });
    return { message: 'Academic year deleted successfully' };
  }
}
