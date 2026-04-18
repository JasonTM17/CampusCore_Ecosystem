import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class LecturersService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    return this.prisma.lecturer.create({
      data,
      include: { user: true, department: true },
    });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [lecturers, total] = await Promise.all([
      this.prisma.lecturer.findMany({
        skip,
        take: limit,
        include: { user: true, department: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.lecturer.count(),
    ]);
    return {
      data: lecturers,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const lecturer = await this.prisma.lecturer.findUnique({
      where: { id },
      include: { user: true, department: true, sections: true },
    });
    if (!lecturer) throw new NotFoundException('Lecturer not found');
    return lecturer;
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.lecturer.update({
      where: { id },
      data,
      include: { user: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.lecturer.delete({ where: { id } });
    return { message: 'Lecturer deleted successfully' };
  }
}
