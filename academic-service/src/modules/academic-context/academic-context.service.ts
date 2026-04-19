import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class AcademicContextService {
  constructor(private readonly prisma: PrismaService) {}

  async getStudentEnrollments(studentId: string) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    return this.prisma.enrollment.findMany({
      where: { studentId },
      include: {
        section: {
          include: {
            course: true,
          },
        },
        gradeItems: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getCurriculum(curriculumId: string) {
    const curriculum = await this.prisma.curriculum.findUnique({
      where: { id: curriculumId },
      include: { department: true },
    });

    if (!curriculum) {
      throw new NotFoundException('Curriculum not found');
    }

    return {
      id: curriculum.id,
      code: curriculum.code,
      name: curriculum.name,
      department: curriculum.department
        ? {
            id: curriculum.department.id,
            code: curriculum.department.code,
            name: curriculum.department.name,
          }
        : null,
    };
  }

  async getDepartment(departmentId: string) {
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
    });

    if (!department) {
      throw new NotFoundException('Department not found');
    }

    return {
      id: department.id,
      code: department.code,
      name: department.name,
    };
  }
}
