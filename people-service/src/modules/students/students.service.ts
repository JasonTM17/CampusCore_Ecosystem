import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { AcademicContextService } from '../people-context/academic-context.service';
import { AuthUserContextService } from '../people-context/auth-user-context.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import {
  PEOPLE_EVENT_TYPES,
  PeopleEventEnvelope,
} from '../rabbitmq/rabbitmq.events';

type StudentRecord = {
  id: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  studentId: string;
  curriculumId: string;
  curriculumCode: string | null;
  curriculumName: string | null;
  departmentId: string | null;
  departmentCode: string | null;
  departmentName: string | null;
  year: number;
  status: string;
  admissionDate: Date;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly academicContextService: AcademicContextService,
    private readonly authUserContextService: AuthUserContextService,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  async create(createStudentDto: CreateStudentDto) {
    const existingStudent = await this.prisma.student.findFirst({
      where: {
        OR: [
          { studentId: createStudentDto.studentId },
          { userId: createStudentDto.userId },
        ],
      },
    });

    if (existingStudent) {
      throw new BadRequestException('Student profile already exists');
    }

    const [userSnapshot, curriculumSnapshot] = await Promise.all([
      this.authUserContextService.getUser(createStudentDto.userId),
      this.academicContextService.getCurriculum(createStudentDto.curriculumId),
    ]);

    const student = await this.prisma.student.create({
      data: {
        userId: createStudentDto.userId,
        email: userSnapshot.email,
        firstName: userSnapshot.firstName,
        lastName: userSnapshot.lastName,
        studentId: createStudentDto.studentId,
        curriculumId: createStudentDto.curriculumId,
        curriculumCode: curriculumSnapshot.code,
        curriculumName: curriculumSnapshot.name,
        departmentId: curriculumSnapshot.department?.id ?? null,
        departmentCode: curriculumSnapshot.department?.code ?? null,
        departmentName: curriculumSnapshot.department?.name ?? null,
        year: createStudentDto.year,
        status: createStudentDto.status || 'ACTIVE',
        admissionDate: new Date(createStudentDto.admissionDate),
      },
    });

    await this.publishStudentEvent(
      PEOPLE_EVENT_TYPES.STUDENT_UPSERTED,
      student,
    );
    return this.mapStudent(student);
  }

  async findAll(page = 1, limit = 20, status?: string) {
    const skip = (page - 1) * limit;
    const where = status ? { status } : undefined;

    const [students, total] = await Promise.all([
      this.prisma.student.findMany({
        skip,
        take: limit,
        where,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.student.count({ where }),
    ]);

    return {
      data: students.map((student) => this.mapStudent(student)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const student = await this.prisma.student.findUnique({
      where: { id },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    return this.mapStudent(student);
  }

  async update(id: string, updateData: Partial<CreateStudentDto>) {
    const existing = await this.prisma.student.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Student not found');
    }

    const [userSnapshot, curriculumSnapshot] = await Promise.all([
      updateData.userId && updateData.userId !== existing.userId
        ? this.authUserContextService.getUser(updateData.userId)
        : Promise.resolve({
            id: existing.userId,
            email: existing.email,
            firstName: existing.firstName,
            lastName: existing.lastName,
          }),
      updateData.curriculumId &&
      updateData.curriculumId !== existing.curriculumId
        ? this.academicContextService.getCurriculum(updateData.curriculumId)
        : Promise.resolve({
            id: existing.curriculumId,
            code: existing.curriculumCode ?? '',
            name: existing.curriculumName ?? '',
            department:
              existing.departmentId && existing.departmentName
                ? {
                    id: existing.departmentId,
                    code: existing.departmentCode ?? '',
                    name: existing.departmentName,
                  }
                : null,
          }),
    ]);

    const student = await this.prisma.student.update({
      where: { id },
      data: {
        userId: updateData.userId ?? existing.userId,
        email: userSnapshot.email,
        firstName: userSnapshot.firstName,
        lastName: userSnapshot.lastName,
        studentId: updateData.studentId ?? existing.studentId,
        curriculumId: updateData.curriculumId ?? existing.curriculumId,
        curriculumCode: curriculumSnapshot.code || null,
        curriculumName: curriculumSnapshot.name || null,
        departmentId: curriculumSnapshot.department?.id ?? null,
        departmentCode: curriculumSnapshot.department?.code ?? null,
        departmentName: curriculumSnapshot.department?.name ?? null,
        year: updateData.year ?? existing.year,
        status: updateData.status ?? existing.status,
        admissionDate: updateData.admissionDate
          ? new Date(updateData.admissionDate)
          : existing.admissionDate,
      },
    });

    await this.publishStudentEvent(
      PEOPLE_EVENT_TYPES.STUDENT_UPSERTED,
      student,
    );
    return this.mapStudent(student);
  }

  async remove(id: string) {
    const existing = await this.prisma.student.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Student not found');
    }

    await this.prisma.student.delete({ where: { id } });
    await this.publishStudentEvent(PEOPLE_EVENT_TYPES.STUDENT_DELETED, {
      id: existing.id,
      userId: existing.userId,
    });

    return { message: 'Student deleted successfully' };
  }

  async getEnrollmentHistory(studentId: string) {
    await this.findOne(studentId);
    return this.academicContextService.getStudentEnrollments(studentId);
  }

  private mapStudent(student: StudentRecord) {
    return {
      id: student.id,
      userId: student.userId,
      studentId: student.studentId,
      curriculumId: student.curriculumId,
      year: student.year,
      status: student.status,
      admissionDate: student.admissionDate,
      createdAt: student.createdAt,
      updatedAt: student.updatedAt,
      user: {
        id: student.userId,
        email: student.email,
        firstName: student.firstName,
        lastName: student.lastName,
      },
      curriculum: {
        id: student.curriculumId,
        code: student.curriculumCode,
        name: student.curriculumName,
        department: student.departmentId
          ? {
              id: student.departmentId,
              code: student.departmentCode,
              name: student.departmentName,
            }
          : null,
      },
    };
  }

  private async publishStudentEvent(
    type:
      | typeof PEOPLE_EVENT_TYPES.STUDENT_UPSERTED
      | typeof PEOPLE_EVENT_TYPES.STUDENT_DELETED,
    payload: Record<string, unknown>,
  ) {
    const event: PeopleEventEnvelope<Record<string, unknown>> = {
      type,
      source: 'campuscore-people-service',
      occurredAt: new Date().toISOString(),
      payload,
    };

    await this.rabbitMQService.publishMessage(event);
  }
}
