import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { PEOPLE_SHADOW_ACADEMIC_QUEUE } from '../rabbitmq/rabbitmq.events';

type StudentUpsertPayload = {
  id: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  studentId: string;
  curriculumId: string;
  year: number;
  status: string;
  admissionDate: string | Date;
};

type LecturerUpsertPayload = {
  id: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  departmentId: string;
  employeeId: string;
  title?: string | null;
  specialization?: string | null;
  office?: string | null;
  phone?: string | null;
  isActive?: boolean;
};

type PeopleShadowEvent = {
  type: string;
  payload: Record<string, unknown>;
};

@Injectable()
export class PeopleShadowConsumer implements OnModuleInit {
  private readonly logger = new Logger(PeopleShadowConsumer.name);

  constructor(
    private readonly rabbitMQService: RabbitMQService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    await this.rabbitMQService.consumeMessages(
      PEOPLE_SHADOW_ACADEMIC_QUEUE,
      async (message) => {
        await this.handleEvent(message as PeopleShadowEvent);
      },
    );
  }

  private async handleEvent(event: PeopleShadowEvent) {
    switch (event.type) {
      case 'student.upserted':
        await this.syncStudent(event.payload as StudentUpsertPayload);
        return;
      case 'student.deleted':
        await this.prisma.student.deleteMany({
          where: { id: String(event.payload.id) },
        });
        return;
      case 'lecturer.upserted':
        await this.syncLecturer(event.payload as LecturerUpsertPayload);
        return;
      case 'lecturer.deleted':
        await this.prisma.lecturer.deleteMany({
          where: { id: String(event.payload.id) },
        });
        return;
      default:
        this.logger.warn(
          `Ignoring unsupported people shadow event: ${event.type}`,
        );
    }
  }

  private async syncStudent(payload: StudentUpsertPayload) {
    const curriculum = await this.prisma.curriculum.findUnique({
      where: { id: payload.curriculumId },
      select: { id: true },
    });

    if (!curriculum) {
      this.logger.warn(
        `Skipping student shadow ${payload.id}: curriculum ${payload.curriculumId} is not present in academic-service`,
      );
      return;
    }

    await this.upsertUser(payload);
    await this.prisma.student.upsert({
      where: { id: payload.id },
      update: {
        userId: payload.userId,
        studentId: payload.studentId,
        curriculumId: payload.curriculumId,
        year: payload.year,
        status: payload.status,
        admissionDate: new Date(payload.admissionDate),
      },
      create: {
        id: payload.id,
        userId: payload.userId,
        studentId: payload.studentId,
        curriculumId: payload.curriculumId,
        year: payload.year,
        status: payload.status,
        admissionDate: new Date(payload.admissionDate),
      },
    });
  }

  private async syncLecturer(payload: LecturerUpsertPayload) {
    const department = await this.prisma.department.findUnique({
      where: { id: payload.departmentId },
      select: { id: true },
    });

    if (!department) {
      this.logger.warn(
        `Skipping lecturer shadow ${payload.id}: department ${payload.departmentId} is not present in academic-service`,
      );
      return;
    }

    await this.upsertUser(payload);
    await this.prisma.lecturer.upsert({
      where: { id: payload.id },
      update: {
        userId: payload.userId,
        departmentId: payload.departmentId,
        employeeId: payload.employeeId,
        title: payload.title ?? null,
        specialization: payload.specialization ?? null,
        office: payload.office ?? null,
        phone: payload.phone ?? null,
        isActive: payload.isActive ?? true,
      },
      create: {
        id: payload.id,
        userId: payload.userId,
        departmentId: payload.departmentId,
        employeeId: payload.employeeId,
        title: payload.title ?? null,
        specialization: payload.specialization ?? null,
        office: payload.office ?? null,
        phone: payload.phone ?? null,
        isActive: payload.isActive ?? true,
      },
    });
  }

  private async upsertUser(payload: {
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
  }) {
    await this.prisma.user.upsert({
      where: { id: payload.userId },
      update: {
        email: payload.email,
        firstName: payload.firstName,
        lastName: payload.lastName,
        status: UserStatus.ACTIVE,
      },
      create: {
        id: payload.userId,
        email: payload.email,
        firstName: payload.firstName,
        lastName: payload.lastName,
        status: UserStatus.ACTIVE,
      },
    });
  }
}
