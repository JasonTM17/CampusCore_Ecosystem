import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class GradesService {
  constructor(private prisma: PrismaService) {}

  async createGradeItem(data: any) {
    return this.prisma.gradeItem.create({ data, include: { section: true } });
  }

  async findAllGradeItems(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [gradeItems, total] = await Promise.all([
      this.prisma.gradeItem.findMany({ skip, take: limit, include: { section: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.gradeItem.count(),
    ]);
    return { data: gradeItems, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOneGradeItem(id: string) {
    const gradeItem = await this.prisma.gradeItem.findUnique({ where: { id }, include: { section: true } });
    if (!gradeItem) throw new NotFoundException('Grade item not found');
    return gradeItem;
  }

  async updateGradeItem(id: string, data: any) {
    await this.findOneGradeItem(id);
    return this.prisma.gradeItem.update({ where: { id }, data, include: { section: true } });
  }

  async removeGradeItem(id: string) {
    await this.findOneGradeItem(id);
    await this.prisma.gradeItem.delete({ where: { id } });
    return { message: 'Grade item deleted successfully' };
  }

  async createStudentGrade(data: any) {
    return this.prisma.studentGrade.create({ data, include: { gradeItem: true, enrollment: true } });
  }

  async findAllStudentGrades(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [studentGrades, total] = await Promise.all([
      this.prisma.studentGrade.findMany({ skip, take: limit, include: { gradeItem: true, enrollment: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.studentGrade.count(),
    ]);
    return { data: studentGrades, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOneStudentGrade(id: string) {
    const studentGrade = await this.prisma.studentGrade.findUnique({ where: { id }, include: { gradeItem: true, enrollment: true } });
    if (!studentGrade) throw new NotFoundException('Student grade not found');
    return studentGrade;
  }

  async updateStudentGrade(id: string, data: any) {
    await this.findOneStudentGrade(id);
    return this.prisma.studentGrade.update({ where: { id }, data, include: { gradeItem: true, enrollment: true } });
  }

  async removeStudentGrade(id: string) {
    await this.findOneStudentGrade(id);
    await this.prisma.studentGrade.delete({ where: { id } });
    return { message: 'Student grade deleted successfully' };
  }
}
