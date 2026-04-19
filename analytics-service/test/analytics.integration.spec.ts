import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as supertest from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { configureHttpApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/common/prisma/prisma.service';

type TestUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  lecturerId?: string | null;
};

describe('Analytics service integration', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let baseUrl: string;

  let adminUser: TestUser;
  let lecturerUser: TestUser;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.FRONTEND_URL ??= 'http://127.0.0.1:3100';
    process.env.HEALTH_READINESS_KEY ??= 'analytics-readiness-key-12345';
    process.env.COOKIE_SECURE ??= 'false';

    const { AppModule } = await import('../src/app.module');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureHttpApp(app);
    await app.listen(0, '127.0.0.1');

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
    baseUrl = await app.getUrl();

    const adminRecord = await prisma.user.findUniqueOrThrow({
      where: { email: 'admin@campuscore.edu' },
    });
    adminUser = {
      id: adminRecord.id,
      email: adminRecord.email,
      firstName: adminRecord.firstName,
      lastName: adminRecord.lastName,
      roles: ['ADMIN'],
    };

    const lecturerRecord = await prisma.lecturer.findFirstOrThrow({
      include: { user: true },
    });
    lecturerUser = {
      id: lecturerRecord.user.id,
      email: lecturerRecord.user.email,
      firstName: lecturerRecord.user.firstName,
      lastName: lecturerRecord.user.lastName,
      roles: ['LECTURER'],
      lecturerId: lecturerRecord.id,
    };
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('serves admin analytics endpoints against seeded data', async () => {
    const adminAuth = await issueBearerAuth(adminUser);

    await supertest(baseUrl)
      .get('/api/v1/analytics/overview')
      .set(adminAuth)
      .expect(200)
      .expect(({ body }) => {
        expect(body.totalStudents).toBeGreaterThan(0);
        expect(body.totalLecturers).toBeGreaterThan(0);
        expect(body.totalCourses).toBeGreaterThan(0);
        expect(body.totalSections).toBeGreaterThan(0);
      });

    await supertest(baseUrl)
      .get('/api/v1/analytics/enrollments-by-semester')
      .set(adminAuth)
      .expect(200)
      .expect(({ body }) => {
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBeGreaterThan(0);
        expect(body[0].semesterId).toBeTruthy();
      });

    await supertest(baseUrl)
      .get('/api/v1/analytics/section-occupancy')
      .set(adminAuth)
      .expect(200)
      .expect(({ body }) => {
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBeGreaterThan(0);
        expect(body[0].courseCode).toBeTruthy();
      });

    await supertest(baseUrl)
      .get('/api/v1/analytics/grade-distribution')
      .set(adminAuth)
      .expect(200)
      .expect(({ body }) => {
        expect(Array.isArray(body)).toBe(true);
        expect(
          body.find((item: { grade: string }) => item.grade === 'A'),
        ).toBeDefined();
      });

    await supertest(baseUrl)
      .get('/api/v1/analytics/enrollment-trends')
      .set(adminAuth)
      .expect(200)
      .expect(({ body }) => {
        expect(Array.isArray(body)).toBe(true);
      });

    await supertest(baseUrl)
      .get('/api/v1/analytics/revenue')
      .set(adminAuth)
      .expect(200)
      .expect(({ body }) => {
        expect(body.totalInvoiced).toBeGreaterThan(0);
        expect(body.invoiceCount).toBeGreaterThan(0);
      });
  });

  it('serves lecturer analytics and readiness endpoints', async () => {
    const lecturerAuth = await issueBearerAuth(lecturerUser);

    await supertest(baseUrl)
      .get('/api/v1/analytics/lecturer/my')
      .set(lecturerAuth)
      .expect(200)
      .expect(({ body }) => {
        expect(body.totalSections).toBeGreaterThan(0);
      });

    await supertest(baseUrl)
      .get('/api/v1/analytics/lecturer/sections')
      .set(lecturerAuth)
      .expect(200)
      .expect(({ body }) => {
        expect(Array.isArray(body)).toBe(true);
      });

    await supertest(baseUrl)
      .get('/api/v1/health/readiness')
      .set('X-Health-Key', 'analytics-readiness-key-12345')
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toMatch(/ok|degraded/);
        expect(body.services.database.status).toBe('up');
        expect(['up', 'down', 'not_configured']).toContain(
          body.services.rabbitmq.status,
        );
      });
  });

  async function issueBearerAuth(user: TestUser) {
    const token = await jwtService.signAsync({
      sub: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: user.roles,
      permissions: [],
      lecturerId: user.lecturerId ?? null,
      studentId: null,
      student: null,
    });

    return {
      Authorization: `Bearer ${token}`,
    };
  }
});
