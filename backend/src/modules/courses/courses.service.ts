import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class CoursesService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    return this.prisma.course.create({ data, include: { department: true, prerequisites: true, curriculumCourses: true } });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [courses, total] = await Promise.all([
      this.prisma.course.findMany({ skip, take: limit, include: { department: true }, orderBy: { code: 'asc' } }),
      this.prisma.course.count(),
    ]);
    return { data: courses, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const course = await this.prisma.course.findUnique({ where: { id }, include: { department: true, prerequisites: true, sections: true } });
    if (!course) throw new NotFoundException('Course not found');
    return course;
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    return this.prisma.course.update({ where: { id }, data, include: { department: true } });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.course.delete({ where: { id } });
    return { message: 'Course deleted successfully' };
  }
}
