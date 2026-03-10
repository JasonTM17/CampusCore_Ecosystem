import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class SemestersService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    return this.prisma.semester.create({ data, include: { academicYear: true, sections: true } });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [semesters, total] = await Promise.all([
      this.prisma.semester.findMany({ skip, take: limit, include: { academicYear: true }, orderBy: { startDate: 'desc' } }),
      this.prisma.semester.count(),
    ]);
    return { data: semesters, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const semester = await this.prisma.semester.findUnique({ where: { id }, include: { academicYear: true, sections: true } });
    if (!semester) throw new NotFoundException('Semester not found');
    return semester;
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.semester.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.semester.delete({ where: { id } });
    return { message: 'Semester deleted successfully' };
  }
}
