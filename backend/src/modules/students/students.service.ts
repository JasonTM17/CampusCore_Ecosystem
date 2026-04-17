import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateStudentDto } from './dto/create-student.dto';

@Injectable()
export class StudentsService {
  constructor(private prisma: PrismaService) {}

  async create(createStudentDto: CreateStudentDto) {
    const existingStudent = await this.prisma.student.findFirst({
      where: { studentId: createStudentDto.studentId },
    });

    if (existingStudent) {
      throw new BadRequestException('Student ID already exists');
    }

    return this.prisma.student.create({
      data: {
        userId: createStudentDto.userId,
        studentId: createStudentDto.studentId,
        curriculumId: createStudentDto.curriculumId,
        year: createStudentDto.year,
        admissionDate: new Date(createStudentDto.admissionDate),
        status: createStudentDto.status || 'ACTIVE',
      },
      include: { user: true, curriculum: true },
    });
  }

  async findAll(page = 1, limit = 20, status?: string) {
    const skip = (page - 1) * limit;

    const [students, total] = await Promise.all([
      this.prisma.student.findMany({
        skip,
        take: limit,
        where: status ? { status: status as any } : undefined,
        include: { user: true, curriculum: true },
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
        curriculum: true,
        enrollments: { include: { section: true } },
        waitlists: true,
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
      include: { section: { include: { course: true } }, gradeItems: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
