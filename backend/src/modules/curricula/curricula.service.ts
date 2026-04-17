import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class CurriculaService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    return this.prisma.curriculum.create({
      data,
      include: { department: true, courses: true },
    });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [curricula, total] = await Promise.all([
      this.prisma.curriculum.findMany({
        skip,
        take: limit,
        include: { department: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.curriculum.count(),
    ]);
    return {
      data: curricula,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const curriculum = await this.prisma.curriculum.findUnique({
      where: { id },
      include: { department: true, courses: true },
    });
    if (!curriculum) throw new NotFoundException('Curriculum not found');
    return curriculum;
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.curriculum.update({
      where: { id },
      data,
      include: { department: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.curriculum.delete({ where: { id } });
    return { message: 'Curriculum deleted successfully' };
  }
}
