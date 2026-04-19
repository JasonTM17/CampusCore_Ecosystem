import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AcademicContextService } from '../people-context/academic-context.service';
import { AuthUserContextService } from '../people-context/auth-user-context.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import {
  PEOPLE_EVENT_TYPES,
  PeopleEventEnvelope,
} from '../rabbitmq/rabbitmq.events';

type LecturerRecord = {
  id: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  departmentId: string;
  departmentCode: string | null;
  departmentName: string | null;
  employeeId: string;
  title: string | null;
  specialization: string | null;
  office: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class LecturersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly academicContextService: AcademicContextService,
    private readonly authUserContextService: AuthUserContextService,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  async create(data: Record<string, unknown>) {
    const existing = await this.prisma.lecturer.findFirst({
      where: {
        OR: [
          { employeeId: String(data.employeeId) },
          { userId: String(data.userId) },
        ],
      },
    });

    if (existing) {
      throw new BadRequestException('Lecturer profile already exists');
    }

    const [userSnapshot, departmentSnapshot] = await Promise.all([
      this.authUserContextService.getUser(String(data.userId)),
      this.academicContextService.getDepartment(String(data.departmentId)),
    ]);

    const lecturer = await this.prisma.lecturer.create({
      data: {
        userId: String(data.userId),
        email: userSnapshot.email,
        firstName: userSnapshot.firstName,
        lastName: userSnapshot.lastName,
        departmentId: departmentSnapshot.id,
        departmentCode: departmentSnapshot.code,
        departmentName: departmentSnapshot.name,
        employeeId: String(data.employeeId),
        title: toNullableString(data.title),
        specialization: toNullableString(data.specialization),
        office: toNullableString(data.office),
        phone: toNullableString(data.phone) ?? userSnapshot.phone ?? null,
        isActive: typeof data.isActive === 'boolean' ? data.isActive : true,
      },
    });

    await this.publishLecturerEvent(
      PEOPLE_EVENT_TYPES.LECTURER_UPSERTED,
      lecturer,
    );

    return this.mapLecturer(lecturer);
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [lecturers, total] = await Promise.all([
      this.prisma.lecturer.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.lecturer.count(),
    ]);

    return {
      data: lecturers.map((lecturer) => this.mapLecturer(lecturer)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const lecturer = await this.prisma.lecturer.findUnique({
      where: { id },
    });
    if (!lecturer) {
      throw new NotFoundException('Lecturer not found');
    }

    return this.mapLecturer(lecturer);
  }

  async update(id: string, data: Record<string, unknown>) {
    const existing = await this.prisma.lecturer.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Lecturer not found');
    }

    const [userSnapshot, departmentSnapshot] = await Promise.all([
      data.userId && String(data.userId) !== existing.userId
        ? this.authUserContextService.getUser(String(data.userId))
        : Promise.resolve({
            id: existing.userId,
            email: existing.email,
            firstName: existing.firstName,
            lastName: existing.lastName,
            phone: existing.phone,
          }),
      data.departmentId && String(data.departmentId) !== existing.departmentId
        ? this.academicContextService.getDepartment(String(data.departmentId))
        : Promise.resolve({
            id: existing.departmentId,
            code: existing.departmentCode ?? '',
            name: existing.departmentName ?? '',
          }),
    ]);

    const lecturer = await this.prisma.lecturer.update({
      where: { id },
      data: {
        userId: data.userId ? String(data.userId) : existing.userId,
        email: userSnapshot.email,
        firstName: userSnapshot.firstName,
        lastName: userSnapshot.lastName,
        departmentId: departmentSnapshot.id,
        departmentCode: departmentSnapshot.code || null,
        departmentName: departmentSnapshot.name || null,
        employeeId: data.employeeId
          ? String(data.employeeId)
          : existing.employeeId,
        title: valueOrExisting(data.title, existing.title),
        specialization: valueOrExisting(
          data.specialization,
          existing.specialization,
        ),
        office: valueOrExisting(data.office, existing.office),
        phone: valueOrExisting(
          data.phone,
          existing.phone ?? userSnapshot.phone ?? null,
        ),
        isActive:
          typeof data.isActive === 'boolean'
            ? data.isActive
            : existing.isActive,
      },
    });

    await this.publishLecturerEvent(
      PEOPLE_EVENT_TYPES.LECTURER_UPSERTED,
      lecturer,
    );

    return this.mapLecturer(lecturer);
  }

  async remove(id: string) {
    const existing = await this.prisma.lecturer.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Lecturer not found');
    }

    await this.prisma.lecturer.delete({ where: { id } });
    await this.publishLecturerEvent(PEOPLE_EVENT_TYPES.LECTURER_DELETED, {
      id: existing.id,
      userId: existing.userId,
    });

    return { message: 'Lecturer deleted successfully' };
  }

  private mapLecturer(lecturer: LecturerRecord) {
    return {
      id: lecturer.id,
      userId: lecturer.userId,
      departmentId: lecturer.departmentId,
      employeeId: lecturer.employeeId,
      title: lecturer.title,
      specialization: lecturer.specialization,
      office: lecturer.office,
      phone: lecturer.phone,
      isActive: lecturer.isActive,
      createdAt: lecturer.createdAt,
      updatedAt: lecturer.updatedAt,
      user: {
        id: lecturer.userId,
        email: lecturer.email,
        firstName: lecturer.firstName,
        lastName: lecturer.lastName,
      },
      department: {
        id: lecturer.departmentId,
        code: lecturer.departmentCode,
        name: lecturer.departmentName,
      },
    };
  }

  private async publishLecturerEvent(
    type:
      | typeof PEOPLE_EVENT_TYPES.LECTURER_UPSERTED
      | typeof PEOPLE_EVENT_TYPES.LECTURER_DELETED,
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

function toNullableString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function valueOrExisting<T>(value: unknown, existing: T) {
  if (value === undefined) {
    return existing;
  }

  if (value === null) {
    return null as T;
  }

  if (typeof value === 'string') {
    return (value.trim().length > 0 ? value : null) as T;
  }

  return value as T;
}
