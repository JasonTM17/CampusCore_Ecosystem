import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as supertest from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { configureHttpApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/common/prisma/prisma.service';
import { CSRF_HEADER } from '../src/modules/auth/auth-session.util';
import { EnrollmentsService } from '../src/modules/enrollments/enrollments.service';
import { WaitlistService } from '../src/modules/waitlist/waitlist.service';

type TestUser = {
  id: string;
  email: string;
  roles: string[];
  studentId?: string | null;
  lecturerId?: string | null;
};

type AuthContext = {
  bearer: Record<string, string>;
  cookie: Record<string, string>;
  csrf: Record<string, string>;
};

const IDS = {
  faculty: 'faculty-1',
  department: 'department-1',
  academicYear: 'academic-year-1',
  semester: 'semester-1',
  curriculum: 'curriculum-1',
  lecturerUser: 'lecturer-user-1',
  lecturerProfile: 'lecturer-profile-1',
  studentUser: 'student-user-1',
  studentProfile: 'student-profile-1',
  secondStudentUser: 'student-user-2',
  secondStudentProfile: 'student-profile-2',
  adminUser: 'admin-user-1',
  courseCompleted: 'course-completed-1',
  courseOpen: 'course-open-1',
  classroomA: 'classroom-a',
  classroomB: 'classroom-b',
  completedSection: 'section-completed-1',
  openSection: 'section-open-1',
  completedSchedule: 'schedule-completed-1',
  openSchedule: 'schedule-open-1',
  completedEnrollment: 'enrollment-completed-1',
  attendance: 'attendance-1',
  gradeItem: 'grade-item-1',
  studentGrade: 'student-grade-1',
  waitlist: 'waitlist-1',
};

describe('Academic service integration', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let enrollmentsService: EnrollmentsService;
  let waitlistService: WaitlistService;
  let baseUrl: string;

  const adminUser: TestUser = {
    id: IDS.adminUser,
    email: 'admin@campuscore.edu',
    roles: ['ADMIN'],
  };

  const studentUser: TestUser = {
    id: IDS.studentUser,
    email: 'student1@campuscore.edu',
    roles: ['STUDENT'],
    studentId: IDS.studentProfile,
  };

  const lecturerUser: TestUser = {
    id: IDS.lecturerUser,
    email: 'john.doe@campuscore.edu',
    roles: ['LECTURER'],
    lecturerId: IDS.lecturerProfile,
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??=
      'postgresql://campuscore:ci-postgres-password@127.0.0.1:5432/campuscore?schema=academic';
    process.env.JWT_SECRET ??= 'ci-jwt-secret';
    process.env.FRONTEND_URL ??= 'http://127.0.0.1:3100';
    process.env.HEALTH_READINESS_KEY ??= 'academic-readiness-key-12345';
    process.env.COOKIE_SECURE ??= 'false';
    process.env.INTERNAL_SERVICE_TOKEN ??= 'academic-internal-token-12345';

    const { AppModule } = await import('../src/app.module');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureHttpApp(app);
    await app.listen(0, '127.0.0.1');

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
    enrollmentsService = app.get(EnrollmentsService);
    waitlistService = app.get(WaitlistService);
    baseUrl = await app.getUrl();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedBaseData();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('supports student cookie auth, csrf enforcement, grades, transcript, and attendance flows', async () => {
    const auth = await issueAuth(studentUser);

    await supertest(baseUrl)
      .get('/api/v1/semesters')
      .set(auth.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toHaveLength(1);
        expect(body.data[0].id).toBe(IDS.semester);
        expect(body.data[0].nameEn).toBeTruthy();
        expect(body.data[0].nameVi).toMatch(/^Học kỳ /u);
      });

    await supertest(baseUrl)
      .post('/api/v1/enrollments/enroll')
      .set(auth.cookie)
      .send({ sectionId: IDS.openSection })
      .expect(403);

    await supertest(baseUrl)
      .post('/api/v1/enrollments/enroll')
      .set(auth.csrf)
      .send({ sectionId: IDS.openSection })
      .expect(201)
      .expect(({ body }) => {
        expect(body.sectionId).toBe(IDS.openSection);
        expect(body.studentId).toBe(IDS.studentProfile);
      });

    await supertest(baseUrl)
      .get('/api/v1/enrollments/my')
      .set(auth.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(2);
      });

    await supertest(baseUrl)
      .get('/api/v1/enrollments/my/grades')
      .set(auth.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
        expect(body[0].courseCode).toBe('COMP101');
        expect(body[0].letterGrade).toBe('B+');
        expect(body[0].courseNameVi).toBe('Nhập môn khoa học máy tính');
        expect(body[0].semesterNameVi).toMatch(/^Học kỳ /u);
      });

    await supertest(baseUrl)
      .get('/api/v1/enrollments/my/transcript')
      .set(auth.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.summary.totalCreditsEarned).toBe(3);
        expect(body.semesters).toHaveLength(1);
        expect(body.semesters[0].semesterNameVi).toMatch(/^Học kỳ /u);
        expect(body.semesters[0].records[0].courseNameVi).toBe(
          'Nhập môn khoa học máy tính',
        );
      });

    await supertest(baseUrl)
      .get('/api/v1/attendance/my')
      .set(auth.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
        expect(body[0].status).toBe('PRESENT');
      });
  });

  it('supports lecturer schedule, grading, and section grade views', async () => {
    const auth = await issueAuth(lecturerUser);

    await supertest(baseUrl)
      .get('/api/v1/sections/my/schedule')
      .set(auth.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(2);
        expect(body[0].courseCode).toBeTruthy();
      });

    await supertest(baseUrl)
      .get('/api/v1/sections/my/grading')
      .set(auth.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(2);
        expect(body[0].sectionId).toBeTruthy();
      });

    await supertest(baseUrl)
      .get(`/api/v1/sections/${IDS.completedSection}/grades`)
      .set(auth.bearer)
      .expect(200)
      .expect(({ body }) => {
        expect(body.sectionId).toBe(IDS.completedSection);
        expect(body.enrollments).toHaveLength(1);
        expect(body.enrollments[0].studentName).toBe('Michael Chen');
      });
  });

  it('supports admin academic CRUD and readiness', async () => {
    const auth = await issueAuth(adminUser);
    const readinessKey =
      process.env.HEALTH_READINESS_KEY ?? 'academic-readiness-key-12345';

    await supertest(baseUrl)
      .post('/api/v1/faculties')
      .set(auth.bearer)
      .send({
        name: 'Business Administration',
        code: 'BUS',
        description: 'Business faculty',
        isActive: true,
      })
      .expect(201);

    const departmentResponse = await supertest(baseUrl)
      .post('/api/v1/departments')
      .set(auth.bearer)
      .send({
        name: 'Business Analytics',
        code: 'BAN',
        facultyId: IDS.faculty,
        description: 'Business analytics department',
        isActive: true,
      })
      .expect(201);

    const yearResponse = await supertest(baseUrl)
      .post('/api/v1/academic-years')
      .set(auth.bearer)
      .send({
        year: 2027,
        startDate: '2027-01-01T00:00:00.000Z',
        endDate: '2027-12-31T00:00:00.000Z',
        isCurrent: false,
      })
      .expect(201);

    const semesterResponse = await supertest(baseUrl)
      .post('/api/v1/semesters')
      .set(auth.bearer)
      .send({
        name: 'Spring 2027',
        type: 'SPRING',
        academicYearId: yearResponse.body.id,
        startDate: '2027-01-10T00:00:00.000Z',
        endDate: '2027-05-20T00:00:00.000Z',
        registrationStart: '2026-12-01T00:00:00.000Z',
        registrationEnd: '2027-01-05T00:00:00.000Z',
        status: 'REGISTRATION_OPEN',
      })
      .expect(201);

    const courseResponse = await supertest(baseUrl)
      .post('/api/v1/courses')
      .set(auth.bearer)
      .send({
        code: 'BUS201',
        name: 'Business Statistics',
        credits: 3,
        departmentId: departmentResponse.body.id,
        semesterId: semesterResponse.body.id,
        isActive: true,
      })
      .expect(201);

    const classroomResponse = await supertest(baseUrl)
      .post('/api/v1/classrooms')
      .set(auth.bearer)
      .send({
        building: 'Innovation Hall',
        roomNumber: '501',
        capacity: 40,
        type: 'LECTURE',
        equipment: ['Projector'],
        isActive: true,
      })
      .expect(201);

    await supertest(baseUrl)
      .post('/api/v1/sections')
      .set(auth.bearer)
      .send({
        sectionNumber: 'C',
        courseId: courseResponse.body.id,
        semesterId: semesterResponse.body.id,
        lecturerId: IDS.lecturerProfile,
        classroomId: classroomResponse.body.id,
        capacity: 35,
        status: 'OPEN',
      })
      .expect(201);

    await supertest(baseUrl)
      .get('/api/v1/health/readiness')
      .set('X-Health-Key', readinessKey)
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toMatch(/ok|degraded/);
        expect(body.services.database.status).toBe('up');
        expect(['up', 'not_configured', 'down']).toContain(
          body.services.rabbitmq.status,
        );
      });
  });

  it('exposes academic internal context only with a valid service token', async () => {
    const serviceToken =
      process.env.INTERNAL_SERVICE_TOKEN ?? 'academic-internal-token-12345';

    await supertest(baseUrl)
      .get(`/api/v1/internal/academic-context/curricula/${IDS.curriculum}`)
      .expect(403);

    await supertest(baseUrl)
      .get(`/api/v1/internal/academic-context/curricula/${IDS.curriculum}`)
      .set('X-Service-Token', serviceToken)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: IDS.curriculum,
          code: 'CS2026',
          name: 'Computer Science 2026',
          department: {
            id: IDS.department,
            code: 'CSE',
            name: 'Computer Science',
          },
        });
      });

    await supertest(baseUrl)
      .get(`/api/v1/internal/academic-context/departments/${IDS.department}`)
      .set('X-Service-Token', serviceToken)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: IDS.department,
          code: 'CSE',
          name: 'Computer Science',
        });
      });

    await supertest(baseUrl)
      .get(
        `/api/v1/internal/academic-context/students/${IDS.studentProfile}/enrollments`,
      )
      .set('X-Service-Token', serviceToken)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({
          id: IDS.completedEnrollment,
          studentId: IDS.studentProfile,
        });
        expect(body[0].section.course.code).toBe('COMP101');
      });
  });

  it('keeps seat allocation atomic when two students race for the final seat', async () => {
    const studentThree = await createStudentFixture('3');
    const studentFour = await createStudentFixture('4');
    const sectionId = 'section-contention-seat-1';

    await createContentionSection({
      courseId: 'course-contention-seat-1',
      courseCode: 'COMP350',
      courseName: 'Concurrency Testing',
      sectionId,
      sectionNumber: 'C1',
      capacity: 1,
    });

    const results = await Promise.all([
      enrollmentsService.enrollStudent(studentThree.studentId, sectionId),
      enrollmentsService.enrollStudent(studentFour.studentId, sectionId),
    ]);

    const storedEnrollments = await prisma.enrollment.findMany({
      where: {
        sectionId,
        status: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] },
      },
    });
    const activeWaitlist = await prisma.waitlist.findMany({
      where: { sectionId, status: 'ACTIVE' },
      orderBy: { position: 'asc' },
    });
    const section = await prisma.section.findUnique({
      where: { id: sectionId },
    });

    expect(results.filter((result) => 'position' in result)).toHaveLength(1);
    expect(results.filter((result) => 'enrolledAt' in result)).toHaveLength(1);
    expect(storedEnrollments).toHaveLength(1);
    expect(activeWaitlist).toHaveLength(1);
    expect(activeWaitlist[0].position).toBe(1);
    expect(section?.enrolledCount).toBe(1);
  });

  it('prevents duplicate promotion when drop and manual promotion overlap', async () => {
    const enrolledStudent = await createStudentFixture('5');
    const firstWaitlistedStudent = await createStudentFixture('6');
    const secondWaitlistedStudent = await createStudentFixture('7');
    const sectionId = 'section-contention-promotion-1';

    await createContentionSection({
      courseId: 'course-contention-promotion-1',
      courseCode: 'COMP351',
      courseName: 'Promotion Testing',
      sectionId,
      sectionNumber: 'C2',
      capacity: 1,
    });

    const enrollment = await prisma.enrollment.create({
      data: {
        id: 'enrollment-contention-promotion-1',
        studentId: enrolledStudent.studentId,
        sectionId,
        semesterId: IDS.semester,
        status: 'CONFIRMED',
      },
    });

    await prisma.section.update({
      where: { id: sectionId },
      data: { enrolledCount: 1 },
    });

    await prisma.waitlist.createMany({
      data: [
        {
          id: 'waitlist-contention-promotion-1',
          studentId: firstWaitlistedStudent.studentId,
          sectionId,
          position: 1,
          status: 'ACTIVE',
        },
        {
          id: 'waitlist-contention-promotion-2',
          studentId: secondWaitlistedStudent.studentId,
          sectionId,
          position: 2,
          status: 'ACTIVE',
        },
      ],
    });

    const settled = await Promise.allSettled([
      enrollmentsService.dropEnrollment(
        enrollment.id,
        enrolledStudent.studentId,
      ),
      waitlistService.promoteStudent('waitlist-contention-promotion-1'),
    ]);

    const promotedStudentEnrollments = await prisma.enrollment.findMany({
      where: {
        sectionId,
        studentId: firstWaitlistedStudent.studentId,
      },
    });
    const activeSeatConsumers = await prisma.enrollment.count({
      where: {
        sectionId,
        status: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] },
      },
    });
    const firstWaitlistEntry = await prisma.waitlist.findUnique({
      where: { id: 'waitlist-contention-promotion-1' },
    });
    const remainingActiveWaitlist = await prisma.waitlist.findMany({
      where: { sectionId, status: 'ACTIVE' },
      orderBy: { position: 'asc' },
    });
    const section = await prisma.section.findUnique({
      where: { id: sectionId },
    });

    expect(
      settled.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      settled.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(promotedStudentEnrollments).toHaveLength(1);
    expect(activeSeatConsumers).toBe(1);
    expect(firstWaitlistEntry?.status).toBe('CONVERTED');
    expect(section?.enrolledCount).toBe(1);
    expect(remainingActiveWaitlist).toHaveLength(1);
    expect(remainingActiveWaitlist[0]).toMatchObject({
      studentId: secondWaitlistedStudent.studentId,
      position: 1,
    });
  });

  async function issueAuth(user: TestUser): Promise<AuthContext> {
    const token = await jwtService.signAsync({
      sub: user.id,
      email: user.email,
      roles: user.roles,
      permissions: [],
      studentId: user.studentId ?? null,
      lecturerId: user.lecturerId ?? null,
    });
    const csrfToken = `${user.id}-csrf-token`;
    const cookieHeader = [
      `cc_access_token=${token}`,
      `cc_refresh_token=${token}`,
      `cc_csrf=${csrfToken}`,
    ].join('; ');

    return {
      bearer: {
        Authorization: `Bearer ${token}`,
      },
      cookie: {
        Cookie: cookieHeader,
      },
      csrf: {
        Cookie: cookieHeader,
        [CSRF_HEADER]: csrfToken,
      },
    };
  }

  async function resetDatabase() {
    await prisma.studentGrade.deleteMany();
    await prisma.gradeItem.deleteMany();
    await prisma.attendance.deleteMany();
    await prisma.waitlist.deleteMany();
    await prisma.enrollment.deleteMany();
    await prisma.sectionSchedule.deleteMany();
    await prisma.section.deleteMany();
    await prisma.classroom.deleteMany();
    await prisma.student.deleteMany();
    await prisma.lecturer.deleteMany();
    await prisma.curriculumCourse.deleteMany();
    await prisma.curriculum.deleteMany();
    await prisma.coursePrerequisite.deleteMany();
    await prisma.course.deleteMany();
    await prisma.semester.deleteMany();
    await prisma.academicYear.deleteMany();
    await prisma.department.deleteMany();
    await prisma.faculty.deleteMany();
    await prisma.user.deleteMany();
  }

  async function seedBaseData() {
    await prisma.user.createMany({
      data: [
        {
          id: IDS.adminUser,
          email: 'admin@campuscore.edu',
          firstName: 'Admin',
          lastName: 'User',
          status: 'ACTIVE',
        },
        {
          id: IDS.studentUser,
          email: 'student1@campuscore.edu',
          firstName: 'Michael',
          lastName: 'Chen',
          status: 'ACTIVE',
        },
        {
          id: IDS.secondStudentUser,
          email: 'student2@campuscore.edu',
          firstName: 'Ava',
          lastName: 'Nguyen',
          status: 'ACTIVE',
        },
        {
          id: IDS.lecturerUser,
          email: 'john.doe@campuscore.edu',
          firstName: 'John',
          lastName: 'Doe',
          status: 'ACTIVE',
        },
      ],
    });

    await prisma.faculty.create({
      data: {
        id: IDS.faculty,
        name: 'Engineering',
        nameEn: 'Engineering',
        nameVi: 'Khoa Kỹ thuật',
        code: 'ENG',
        description: 'Engineering faculty',
        descriptionEn: 'Engineering faculty',
        descriptionVi: 'Khoa Kỹ thuật',
        isActive: true,
      },
    });

    await prisma.department.create({
      data: {
        id: IDS.department,
        name: 'Computer Science',
        nameEn: 'Computer Science',
        nameVi: 'Khoa học máy tính',
        code: 'CSE',
        facultyId: IDS.faculty,
        description: 'Computer science department',
        descriptionEn: 'Computer science department',
        descriptionVi: 'Bộ môn Khoa học máy tính',
        isActive: true,
      },
    });

    const now = new Date();
    const registrationStart = new Date(
      now.getTime() - 1000 * 60 * 60 * 24 * 14,
    );
    const registrationEnd = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 14);
    const addDropStart = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 7);
    const addDropEnd = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 21);
    const semesterStart = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 3);
    const semesterEnd = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 90);

    await prisma.academicYear.create({
      data: {
        id: IDS.academicYear,
        year: now.getUTCFullYear(),
        startDate: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
        endDate: new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 23, 59, 59)),
        isCurrent: true,
      },
    });

    await prisma.semester.create({
      data: {
        id: IDS.semester,
        name: 'Current Term',
        nameEn: `Fall ${now.getUTCFullYear()}`,
        nameVi: `Học kỳ Thu ${now.getUTCFullYear()}`,
        type: 'FALL',
        academicYearId: IDS.academicYear,
        startDate: semesterStart,
        endDate: semesterEnd,
        registrationStart,
        registrationEnd,
        addDropStart,
        addDropEnd,
        status: 'REGISTRATION_OPEN',
      },
    });

    await prisma.curriculum.create({
      data: {
        id: IDS.curriculum,
        name: 'Computer Science 2026',
        nameEn: 'Computer Science 2026',
        nameVi: 'Chương trình Khoa học máy tính 2026',
        code: 'CS2026',
        departmentId: IDS.department,
        academicYearId: IDS.academicYear,
        totalCredits: 120,
        description: 'Computer science curriculum',
        descriptionEn: 'Computer science curriculum',
        descriptionVi:
          'Chương trình Khoa học máy tính cho khóa tuyển sinh 2026',
        isActive: true,
      },
    });

    await prisma.lecturer.create({
      data: {
        id: IDS.lecturerProfile,
        userId: IDS.lecturerUser,
        departmentId: IDS.department,
        employeeId: 'EMP001',
        title: 'Dr.',
        specialization: 'Distributed Systems',
        isActive: true,
      },
    });

    await prisma.student.create({
      data: {
        id: IDS.studentProfile,
        userId: IDS.studentUser,
        studentId: 'STU001',
        curriculumId: IDS.curriculum,
        year: 2,
        status: 'ACTIVE',
        admissionDate: new Date('2025-09-01T00:00:00.000Z'),
      },
    });

    await prisma.student.create({
      data: {
        id: IDS.secondStudentProfile,
        userId: IDS.secondStudentUser,
        studentId: 'STU002',
        curriculumId: IDS.curriculum,
        year: 2,
        status: 'ACTIVE',
        admissionDate: new Date('2025-09-01T00:00:00.000Z'),
      },
    });

    await prisma.course.createMany({
      data: [
        {
          id: IDS.courseCompleted,
          code: 'COMP101',
          name: 'Introduction to Computer Science',
          nameEn: 'Introduction to Computer Science',
          nameVi: 'Nhập môn khoa học máy tính',
          credits: 3,
          departmentId: IDS.department,
          semesterId: IDS.semester,
          isActive: true,
        },
        {
          id: IDS.courseOpen,
          code: 'COMP202',
          name: 'Data Structures',
          nameEn: 'Data Structures',
          nameVi: 'Cấu trúc dữ liệu',
          credits: 3,
          departmentId: IDS.department,
          semesterId: IDS.semester,
          isActive: true,
        },
      ],
    });

    await prisma.classroom.createMany({
      data: [
        {
          id: IDS.classroomA,
          building: 'Science Hall',
          roomNumber: '201',
          capacity: 40,
          type: 'LECTURE',
          equipment: ['Projector'],
          isActive: true,
        },
        {
          id: IDS.classroomB,
          building: 'Science Hall',
          roomNumber: '202',
          capacity: 35,
          type: 'LECTURE',
          equipment: ['Projector'],
          isActive: true,
        },
      ],
    });

    await prisma.section.createMany({
      data: [
        {
          id: IDS.completedSection,
          sectionNumber: 'A',
          courseId: IDS.courseCompleted,
          semesterId: IDS.semester,
          lecturerId: IDS.lecturerProfile,
          classroomId: IDS.classroomA,
          capacity: 30,
          enrolledCount: 1,
          status: 'OPEN',
        },
        {
          id: IDS.openSection,
          sectionNumber: 'B',
          courseId: IDS.courseOpen,
          semesterId: IDS.semester,
          lecturerId: IDS.lecturerProfile,
          classroomId: IDS.classroomB,
          capacity: 35,
          enrolledCount: 0,
          status: 'OPEN',
        },
      ],
    });

    await prisma.sectionSchedule.createMany({
      data: [
        {
          id: IDS.completedSchedule,
          sectionId: IDS.completedSection,
          classroomId: IDS.classroomA,
          dayOfWeek: 1,
          startTime: '09:00',
          endTime: '10:30',
        },
        {
          id: IDS.openSchedule,
          sectionId: IDS.openSection,
          classroomId: IDS.classroomB,
          dayOfWeek: 3,
          startTime: '13:00',
          endTime: '14:30',
        },
      ],
    });

    await prisma.enrollment.create({
      data: {
        id: IDS.completedEnrollment,
        studentId: IDS.studentProfile,
        sectionId: IDS.completedSection,
        semesterId: IDS.semester,
        status: 'COMPLETED',
        gradeStatus: 'PUBLISHED',
        finalGrade: 88.5,
        letterGrade: 'B+',
      },
    });

    await prisma.attendance.create({
      data: {
        id: IDS.attendance,
        studentId: IDS.studentProfile,
        sectionId: IDS.completedSection,
        date: new Date('2026-09-08T00:00:00.000Z'),
        status: 'PRESENT',
      },
    });

    await prisma.gradeItem.create({
      data: {
        id: IDS.gradeItem,
        sectionId: IDS.completedSection,
        courseId: IDS.courseCompleted,
        name: 'Final Exam',
        type: 'FINAL',
        maxScore: 100,
        weight: 40,
      },
    });

    await prisma.studentGrade.create({
      data: {
        id: IDS.studentGrade,
        gradeItemId: IDS.gradeItem,
        enrollmentId: IDS.completedEnrollment,
        score: 88.5,
      },
    });

    await prisma.waitlist.create({
      data: {
        id: IDS.waitlist,
        studentId: IDS.secondStudentProfile,
        sectionId: IDS.openSection,
        position: 1,
        status: 'ACTIVE',
      },
    });
  }

  async function createStudentFixture(suffix: string) {
    const userId = `student-user-${suffix}`;
    const studentId = `student-profile-${suffix}`;

    await prisma.user.create({
      data: {
        id: userId,
        email: `student${suffix}@campuscore.edu`,
        firstName: `Student${suffix}`,
        lastName: 'Load',
        status: 'ACTIVE',
      },
    });

    await prisma.student.create({
      data: {
        id: studentId,
        userId,
        studentId: `STU10${suffix}`,
        curriculumId: IDS.curriculum,
        year: 2,
        status: 'ACTIVE',
        admissionDate: new Date('2025-09-01T00:00:00.000Z'),
      },
    });

    return { userId, studentId };
  }

  async function createContentionSection({
    courseId,
    courseCode,
    courseName,
    sectionId,
    sectionNumber,
    capacity,
  }: {
    courseId: string;
    courseCode: string;
    courseName: string;
    sectionId: string;
    sectionNumber: string;
    capacity: number;
  }) {
    await prisma.course.create({
      data: {
        id: courseId,
        code: courseCode,
        name: courseName,
        credits: 3,
        departmentId: IDS.department,
        semesterId: IDS.semester,
        isActive: true,
      },
    });

    await prisma.section.create({
      data: {
        id: sectionId,
        sectionNumber,
        courseId,
        semesterId: IDS.semester,
        lecturerId: IDS.lecturerProfile,
        classroomId: IDS.classroomA,
        capacity,
        enrolledCount: 0,
        status: 'OPEN',
      },
    });
  }
});
