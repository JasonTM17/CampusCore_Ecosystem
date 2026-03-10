import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class SectionsService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    return this.prisma.section.create({ data, include: { course: true, semester: true, lecturer: true, classroom: true, enrollments: true, waitlist: true } });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [sections, total] = await Promise.all([
      this.prisma.section.findMany({ skip, take: limit, include: { course: true, semester: true, lecturer: true }, orderBy: { sectionNumber: 'asc' } }),
      this.prisma.section.count(),
    ]);
    return { data: sections, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const section = await this.prisma.section.findUnique({ where: { id }, include: { course: true, semester: true, lecturer: true, classroom: true, enrollments: true, waitlist: true } });
    if (!section) throw new NotFoundException('Section not found');
    return section;
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.section.update({ where: { id }, data, include: { course: true, lecturer: true } });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.section.delete({ where: { id } });
    return { message: 'Section deleted successfully' };
  }
}
