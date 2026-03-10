import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class EnrollmentsService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    const section = await this.prisma.section.findUnique({ where: { id: data.sectionId }, include: { enrollments: true } });
    if (!section) throw new NotFoundException('Section not found');
    if (section.enrollments.length >= section.capacity) {
      throw new BadRequestException('Section is full');
    }
    const existing = await this.prisma.enrollment.findFirst({ where: { studentId: data.studentId, sectionId: data.sectionId } });
    if (existing) throw new BadRequestException('Already enrolled');
    return this.prisma.enrollment.create({ data, include: { student: true, section: true } });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [enrollments, total] = await Promise.all([
      this.prisma.enrollment.findMany({ skip, take: limit, include: { student: true, section: true }, orderBy: { enrolledAt: 'desc' } }),
      this.prisma.enrollment.count(),
    ]);
    return { data: enrollments, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const enrollment = await this.prisma.enrollment.findUnique({ where: { id }, include: { student: true, section: true } });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    return enrollment;
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.enrollment.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.enrollment.delete({ where: { id } });
    return { message: 'Enrollment deleted successfully' };
  }
}
