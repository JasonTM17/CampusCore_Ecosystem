import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class SectionsService {
  constructor(private prisma: PrismaService) {}

  async createSection(data: any) {
    return this.prisma.section.create({ data, include: { course: true, semester: true, lecturer: true, classroom: true, enrollments: true, waitlists: true } });
  }

  async findAllSections(page = 1, limit = 100, semesterId?: string, departmentId?: string, courseId?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    
    if (semesterId) {
      where.semesterId = semesterId;
    }
    if (courseId) {
      where.courseId = courseId;
    }
    if (departmentId) {
      where.course = { departmentId };
    }

    const [sections, total] = await Promise.all([
      this.prisma.section.findMany({ 
        skip, 
        take: limit, 
        where,
        include: { 
          course: { include: { department: true } }, 
          semester: true, 
          lecturer: { include: { user: true } },
          schedules: true,
          classroom: true,
        }, 
        orderBy: { sectionNumber: 'asc' } 
      }),
      this.prisma.section.count({ where }),
    ]);
    return { data: sections, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOneSection(id: string) {
    const section = await this.prisma.section.findUnique({ where: { id }, include: { course: true, semester: true, lecturer: true, classroom: true, enrollments: true, waitlists: true } });
    if (!section) throw new NotFoundException('Section not found');
    return section;
  }

  async updateSection(id: string, data: any) {
    await this.findOneSection(id);
    return this.prisma.section.update({ where: { id }, data, include: { course: true, lecturer: true } });
  }

  async removeSection(id: string) {
    await this.findOneSection(id);
    await this.prisma.section.delete({ where: { id } });
    return { message: 'Section deleted successfully' };
  }
}
