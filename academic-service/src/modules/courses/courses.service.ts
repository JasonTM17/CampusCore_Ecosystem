import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  hydrateLocalizedCatalogRecord,
  normalizeLocalizedCatalogData,
} from '../common/catalog-localization';

@Injectable()
export class CoursesService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    const course = await this.prisma.course.create({
      data: {
        ...data,
        ...normalizeLocalizedCatalogData('course', data),
      },
      include: {
        department: true,
        prerequisites: true,
        curriculumCourses: true,
      },
    });

    return this.hydrateCourse(course);
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [courses, total] = await Promise.all([
      this.prisma.course.findMany({
        skip,
        take: limit,
        include: { department: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.course.count(),
    ]);
    return {
      data: courses.map((course) => this.hydrateCourse(course)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: { department: true, prerequisites: true, sections: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    return this.hydrateCourse(course);
  }

  async update(id: string, data: any) {
    const existing = await this.prisma.course.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Course not found');
    }

    const course = await this.prisma.course.update({
      where: { id },
      data: {
        ...data,
        ...normalizeLocalizedCatalogData('course', data, existing),
      },
      include: { department: true },
    });

    return this.hydrateCourse(course);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.course.delete({ where: { id } });
    return { message: 'Course deleted successfully' };
  }

  private hydrateCourse<T extends { department?: any }>(course: T) {
    return {
      ...hydrateLocalizedCatalogRecord('course', course as any),
      department: course.department
        ? hydrateLocalizedCatalogRecord('department', course.department)
        : course.department,
    };
  }
}
