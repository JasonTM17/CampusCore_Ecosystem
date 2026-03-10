import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class DepartmentsService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    return this.prisma.department.create({ data, include: { faculty: true, lecturers: true } });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [departments, total] = await Promise.all([
      this.prisma.department.findMany({ skip, take: limit, include: { faculty: true }, orderBy: { name: 'asc' } }),
      this.prisma.department.count(),
    ]);
    return { data: departments, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const department = await this.prisma.department.findUnique({ where: { id }, include: { faculty: true, lecturers: true } });
    if (!department) throw new NotFoundException('Department not found');
    return department;
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.department.update({ where: { id }, data, include: { faculty: true } });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.department.delete({ where: { id } });
    return { message: 'Department deleted successfully' };
  }
}
