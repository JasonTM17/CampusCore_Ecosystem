import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from './modules/common/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { StudentsModule } from './modules/students/students.module';
import { LecturersModule } from './modules/lecturers/lecturers.module';
import { FacultiesModule } from './modules/faculties/faculties.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { AcademicYearsModule } from './modules/academic-years/academic-years.module';
import { SemestersModule } from './modules/semesters/semesters.module';
import { CoursesModule } from './modules/courses/courses.module';
import { CurriculaModule } from './modules/curricula/curricula.module';
import { SectionsModule } from './modules/sections/sections.module';
import { EnrollmentsModule } from './modules/enrollments/enrollments.module';
import { WaitlistModule } from './modules/waitlist/waitlist.module';
import { FinanceModule } from './modules/finance/finance.module';
import { GradesModule } from './modules/grades/grades.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { SupportTicketsModule } from './modules/support-tickets/support-tickets.module';
import { ClassroomsModule } from './modules/classrooms/classrooms.module';
import { SchedulesModule } from './modules/schedules/schedules.module';
import { HealthModule } from './modules/health/health.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    StudentsModule,
    LecturersModule,
    FacultiesModule,
    DepartmentsModule,
    AcademicYearsModule,
    SemestersModule,
    CoursesModule,
    CurriculaModule,
    SectionsModule,
    EnrollmentsModule,
    WaitlistModule,
    FinanceModule,
    GradesModule,
    AttendanceModule,
    AnnouncementsModule,
    NotificationsModule,
    AuditLogsModule,
    SupportTicketsModule,
    ClassroomsModule,
    SchedulesModule,
    HealthModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
