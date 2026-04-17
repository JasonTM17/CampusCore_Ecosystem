import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class ClassroomsService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    return this.prisma.classroom.create({ data, include: { sections: true } });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [classrooms, total] = await Promise.all([
      this.prisma.classroom.findMany({
        skip,
        take: limit,
        orderBy: { building: 'asc' },
      }),
      this.prisma.classroom.count(),
    ]);
    return {
      data: classrooms,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const classroom = await this.prisma.classroom.findUnique({
      where: { id },
      include: { sections: true },
    });
    if (!classroom) throw new NotFoundException('Classroom not found');
    return classroom;
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.classroom.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.classroom.delete({ where: { id } });
    return { message: 'Classroom deleted successfully' };
  }
}
