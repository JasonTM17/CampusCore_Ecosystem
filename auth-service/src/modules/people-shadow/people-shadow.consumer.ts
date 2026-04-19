import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';

const PEOPLE_SHADOW_QUEUE = 'people-shadow' as const;

type StudentUpsertPayload = {
  id: string;
  userId: string;
  studentId: string;
  curriculumId: string;
  year: number;
  status: string;
  admissionDate: string;
};

type LecturerUpsertPayload = {
  id: string;
  userId: string;
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
      PEOPLE_SHADOW_QUEUE,
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
}
