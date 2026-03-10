import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateStudentDto } from './dto/create-student.dto';

@Injectable()
export class StudentsService {
  constructor(private prisma: PrismaService) {}

  async create(createStudentDto: CreateStudentDto) {
    const existingStudent = await this.prisma.student.findFirst({
      where: { studentCode: createStudentDto.studentCode },
    });

    if (existingStudent) {
      throw new BadRequestException('Student code already exists');
    }

    return this.prisma.student.create({
      data: createStudentDto,
      include: { user: true },
    });
  }

  async findAll(page = 1, limit = 20, status?: string) {
    const skip = (page - 1) * limit;

    const [students, total] = await Promise.all([
      this.prisma.student.findMany({
        skip,
        take: limit,
        where: status ? { status: status as any } : undefined,
        include: { user: true, department: true, enrollments: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.student.count(),
    ]);

    return {
      data: students,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: {
        user: true,
        department: true,
        enrollments: { include: { course: true } },
        waitlist: true,
      },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    return student;
  }

  async update(id: string, updateData: any) {
    await this.findOne(id);
    return this.prisma.student.update({
      where: { id },
      data: updateData,
      include: { user: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.student.delete({ where: { id } });
    return { message: 'Student deleted successfully' };
  }

  async getEnrollmentHistory(studentId: string) {
    return this.prisma.enrollment.findMany({
      where: { studentId },
      include: { course: true, section: true, grades: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
