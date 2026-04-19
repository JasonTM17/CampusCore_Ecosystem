import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnvironment } from './config/env.validation';
import { PrismaModule } from './modules/common/prisma/prisma.module';
import { CommonModule } from './modules/common/common.module';
import { AuthModule } from './modules/auth/auth.module';
import { RabbitMQModule } from './modules/rabbitmq/rabbitmq.module';
import { HealthModule } from './modules/health/health.module';
import { AcademicYearsModule } from './modules/academic-years/academic-years.module';
import { AcademicContextModule } from './modules/academic-context/academic-context.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { ClassroomsModule } from './modules/classrooms/classrooms.module';
import { CoursesModule } from './modules/courses/courses.module';
import { CurriculaModule } from './modules/curricula/curricula.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { EnrollmentsModule } from './modules/enrollments/enrollments.module';
import { FacultiesModule } from './modules/faculties/faculties.module';
import { GradesModule } from './modules/grades/grades.module';
import { SchedulesModule } from './modules/schedules/schedules.module';
import { SectionsModule } from './modules/sections/sections.module';
import { SemestersModule } from './modules/semesters/semesters.module';
import { WaitlistModule } from './modules/waitlist/waitlist.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile:
        process.env.NODE_ENV === 'test' ||
        process.env.NODE_ENV === 'production',
      envFilePath: '.env',
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 1000,
        limit: 20,
      },
    ]),
    PrismaModule,
    CommonModule,
    AuthModule,
    RabbitMQModule,
    HealthModule,
    AcademicContextModule,
    FacultiesModule,
    DepartmentsModule,
    AcademicYearsModule,
    SemestersModule,
    CoursesModule,
    CurriculaModule,
    ClassroomsModule,
    SectionsModule,
    EnrollmentsModule,
    WaitlistModule,
    GradesModule,
    AttendanceModule,
    SchedulesModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
