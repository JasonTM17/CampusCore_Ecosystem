import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class FacultiesService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    return this.prisma.faculty.create({ data, include: { departments: true } });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [faculties, total] = await Promise.all([
      this.prisma.faculty.findMany({ skip, take: limit, include: { departments: true }, orderBy: { name: 'asc' } }),
      this.prisma.faculty.count(),
    ]);
    return { data: faculties, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const faculty = await this.prisma.faculty.findUnique({ where: { id }, include: { departments: true } });
    if (!faculty) throw new NotFoundException('Faculty not found');
    return faculty;
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.faculty.update({ where: { id }, data, include: { departments: true } });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.faculty.delete({ where: { id } });
    return { message: 'Faculty deleted successfully' };
  }
}
