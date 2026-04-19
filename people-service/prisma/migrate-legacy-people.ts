import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateLegacyPeople() {
  const tables = (
    await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
      `
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('Student', 'Lecturer', 'User', 'Curriculum', 'Department')
    `,
    )
  ).map((row) => row.tablename);

  if (!tables.includes('Student') || !tables.includes('Lecturer')) {
    console.log(
      '[people-service] No legacy student/lecturer tables found in public schema. Skipping migration.',
    );
    return;
  }

  await prisma.$executeRawUnsafe(`
    INSERT INTO "people"."Student" (
      "id",
      "userId",
      "email",
      "firstName",
      "lastName",
      "studentId",
      "curriculumId",
      "curriculumCode",
      "curriculumName",
      "departmentId",
      "departmentCode",
      "departmentName",
      "year",
      "status",
      "admissionDate",
      "createdAt",
      "updatedAt"
    )
    SELECT
      s."id",
      s."userId",
      u."email",
      u."firstName",
      u."lastName",
      s."studentId",
      s."curriculumId",
      c."code",
      c."name",
      d."id",
      d."code",
      d."name",
      s."year",
      s."status",
      s."admissionDate",
      s."createdAt",
      s."updatedAt"
    FROM "public"."Student" s
    INNER JOIN "public"."User" u ON u."id" = s."userId"
    LEFT JOIN "public"."Curriculum" c ON c."id" = s."curriculumId"
    LEFT JOIN "public"."Department" d ON d."id" = c."departmentId"
    ON CONFLICT ("id") DO UPDATE SET
      "userId" = EXCLUDED."userId",
      "email" = EXCLUDED."email",
      "firstName" = EXCLUDED."firstName",
      "lastName" = EXCLUDED."lastName",
      "studentId" = EXCLUDED."studentId",
      "curriculumId" = EXCLUDED."curriculumId",
      "curriculumCode" = EXCLUDED."curriculumCode",
      "curriculumName" = EXCLUDED."curriculumName",
      "departmentId" = EXCLUDED."departmentId",
      "departmentCode" = EXCLUDED."departmentCode",
      "departmentName" = EXCLUDED."departmentName",
      "year" = EXCLUDED."year",
      "status" = EXCLUDED."status",
      "admissionDate" = EXCLUDED."admissionDate",
      "updatedAt" = EXCLUDED."updatedAt"
  `);

  await prisma.$executeRawUnsafe(`
    INSERT INTO "people"."Lecturer" (
      "id",
      "userId",
      "email",
      "firstName",
      "lastName",
      "departmentId",
      "departmentCode",
      "departmentName",
      "employeeId",
      "title",
      "specialization",
      "office",
      "phone",
      "isActive",
      "createdAt",
      "updatedAt"
    )
    SELECT
      l."id",
      l."userId",
      u."email",
      u."firstName",
      u."lastName",
      l."departmentId",
      d."code",
      d."name",
      l."employeeId",
      l."title",
      l."specialization",
      l."office",
      COALESCE(l."phone", u."phone"),
      l."isActive",
      l."createdAt",
      l."updatedAt"
    FROM "public"."Lecturer" l
    INNER JOIN "public"."User" u ON u."id" = l."userId"
    LEFT JOIN "public"."Department" d ON d."id" = l."departmentId"
    ON CONFLICT ("id") DO UPDATE SET
      "userId" = EXCLUDED."userId",
      "email" = EXCLUDED."email",
      "firstName" = EXCLUDED."firstName",
      "lastName" = EXCLUDED."lastName",
      "departmentId" = EXCLUDED."departmentId",
      "departmentCode" = EXCLUDED."departmentCode",
      "departmentName" = EXCLUDED."departmentName",
      "employeeId" = EXCLUDED."employeeId",
      "title" = EXCLUDED."title",
      "specialization" = EXCLUDED."specialization",
      "office" = EXCLUDED."office",
      "phone" = EXCLUDED."phone",
      "isActive" = EXCLUDED."isActive",
      "updatedAt" = EXCLUDED."updatedAt"
  `);

  console.log('[people-service] Legacy people migration completed.');
}

migrateLegacyPeople()
  .catch((error) => {
    console.error('[people-service] Legacy people migration failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
