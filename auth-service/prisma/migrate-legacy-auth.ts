import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function tableExists(schema: string, table: string) {
  const result = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = ${schema}
        AND table_name = ${table}
    ) AS "exists"
  `;

  return result[0]?.exists === true;
}

async function migrateLegacyAuth() {
  const hasUsers = await tableExists('public', 'User');
  const hasSessions = await tableExists('public', 'Session');
  const hasRoles = await tableExists('public', 'Role');
  const hasPermissions = await tableExists('public', 'Permission');
  const hasUserRoles = await tableExists('public', 'UserRole');
  const hasRolePermissions = await tableExists('public', 'RolePermission');
  const hasStudents = await tableExists('public', 'Student');
  const hasLecturers = await tableExists('public', 'Lecturer');

  if (!hasUsers) {
    console.log(
      '[auth-service] No legacy auth tables found in public schema. Skipping migration.',
    );
    return;
  }

  await prisma.$executeRawUnsafe(`
    INSERT INTO "auth"."User" (
      "id", "email", "password", "firstName", "lastName", "phone", "gender",
      "dateOfBirth", "address", "avatar", "status", "emailVerified",
      "isSuperAdmin", "failedLoginAttempts", "lockedUntil", "lastLoginAt",
      "passwordChangedAt", "refreshToken", "resetToken", "resetExpires",
      "verificationToken", "createdAt", "updatedAt"
    )
    SELECT
      u."id", u."email", u."password", u."firstName", u."lastName", u."phone",
      u."gender"::text::"auth"."Gender", u."dateOfBirth", u."address",
      u."avatar", u."status"::text::"auth"."UserStatus", u."emailVerified",
      u."isSuperAdmin", u."failedLoginAttempts", u."lockedUntil", u."lastLoginAt",
      u."passwordChangedAt", u."refreshToken", u."resetToken", u."resetExpires",
      u."verificationToken", u."createdAt", u."updatedAt"
    FROM "public"."User" u
    ON CONFLICT ("id") DO UPDATE SET
      "email" = EXCLUDED."email",
      "password" = EXCLUDED."password",
      "firstName" = EXCLUDED."firstName",
      "lastName" = EXCLUDED."lastName",
      "phone" = EXCLUDED."phone",
      "gender" = EXCLUDED."gender",
      "dateOfBirth" = EXCLUDED."dateOfBirth",
      "address" = EXCLUDED."address",
      "avatar" = EXCLUDED."avatar",
      "status" = EXCLUDED."status",
      "emailVerified" = EXCLUDED."emailVerified",
      "isSuperAdmin" = EXCLUDED."isSuperAdmin",
      "failedLoginAttempts" = EXCLUDED."failedLoginAttempts",
      "lockedUntil" = EXCLUDED."lockedUntil",
      "lastLoginAt" = EXCLUDED."lastLoginAt",
      "passwordChangedAt" = EXCLUDED."passwordChangedAt",
      "refreshToken" = EXCLUDED."refreshToken",
      "resetToken" = EXCLUDED."resetToken",
      "resetExpires" = EXCLUDED."resetExpires",
      "verificationToken" = EXCLUDED."verificationToken",
      "updatedAt" = EXCLUDED."updatedAt"
  `);

  if (hasRoles) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "auth"."Role" (
        "id", "name", "description", "isSystem", "createdAt", "updatedAt"
      )
      SELECT
        r."id",
        r."name"::text::"auth"."RoleName",
        r."description",
        r."isSystem",
        r."createdAt",
        r."updatedAt"
      FROM "public"."Role" r
      ON CONFLICT ("id") DO UPDATE SET
        "name" = EXCLUDED."name",
        "description" = EXCLUDED."description",
        "isSystem" = EXCLUDED."isSystem",
        "updatedAt" = EXCLUDED."updatedAt"
    `);
  }

  if (hasPermissions) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "auth"."Permission" (
        "id", "name", "description", "module", "action", "createdAt"
      )
      SELECT
        p."id", p."name", p."description", p."module", p."action", p."createdAt"
      FROM "public"."Permission" p
      ON CONFLICT ("id") DO UPDATE SET
        "name" = EXCLUDED."name",
        "description" = EXCLUDED."description",
        "module" = EXCLUDED."module",
        "action" = EXCLUDED."action"
    `);
  }

  if (hasUserRoles) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "auth"."UserRole" ("id", "userId", "roleId")
      SELECT ur."id", ur."userId", ur."roleId"
      FROM "public"."UserRole" ur
      ON CONFLICT ("id") DO UPDATE SET
        "userId" = EXCLUDED."userId",
        "roleId" = EXCLUDED."roleId"
    `);
  }

  if (hasRolePermissions) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "auth"."RolePermission" ("id", "roleId", "permissionId")
      SELECT rp."id", rp."roleId", rp."permissionId"
      FROM "public"."RolePermission" rp
      ON CONFLICT ("id") DO UPDATE SET
        "roleId" = EXCLUDED."roleId",
        "permissionId" = EXCLUDED."permissionId"
    `);
  }

  if (hasSessions) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "auth"."Session" (
        "id", "userId", "refreshToken", "userAgent", "ipAddress", "expiresAt", "createdAt"
      )
      SELECT
        s."id", s."userId", s."refreshToken", s."userAgent", s."ipAddress",
        s."expiresAt", s."createdAt"
      FROM "public"."Session" s
      ON CONFLICT ("id") DO UPDATE SET
        "userId" = EXCLUDED."userId",
        "refreshToken" = EXCLUDED."refreshToken",
        "userAgent" = EXCLUDED."userAgent",
        "ipAddress" = EXCLUDED."ipAddress",
        "expiresAt" = EXCLUDED."expiresAt"
    `);
  }

  if (hasStudents) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "auth"."Student" (
        "id", "userId", "studentId", "curriculumId", "year", "status",
        "admissionDate", "createdAt", "updatedAt"
      )
      SELECT
        s."id", s."userId", s."studentId", s."curriculumId", s."year",
        s."status", s."admissionDate", s."createdAt", s."updatedAt"
      FROM "public"."Student" s
      ON CONFLICT ("id") DO UPDATE SET
        "userId" = EXCLUDED."userId",
        "studentId" = EXCLUDED."studentId",
        "curriculumId" = EXCLUDED."curriculumId",
        "year" = EXCLUDED."year",
        "status" = EXCLUDED."status",
        "admissionDate" = EXCLUDED."admissionDate",
        "updatedAt" = EXCLUDED."updatedAt"
    `);
  }

  if (hasLecturers) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "auth"."Lecturer" (
        "id", "userId", "departmentId", "employeeId", "title",
        "specialization", "office", "phone", "createdAt", "updatedAt", "isActive"
      )
      SELECT
        l."id", l."userId", l."departmentId", l."employeeId", l."title",
        l."specialization", l."office", l."phone", l."createdAt", l."updatedAt",
        l."isActive"
      FROM "public"."Lecturer" l
      ON CONFLICT ("id") DO UPDATE SET
        "userId" = EXCLUDED."userId",
        "departmentId" = EXCLUDED."departmentId",
        "employeeId" = EXCLUDED."employeeId",
        "title" = EXCLUDED."title",
        "specialization" = EXCLUDED."specialization",
        "office" = EXCLUDED."office",
        "phone" = EXCLUDED."phone",
        "updatedAt" = EXCLUDED."updatedAt",
        "isActive" = EXCLUDED."isActive"
    `);
  }

  console.log('[auth-service] Legacy auth migration completed.');
}

migrateLegacyAuth()
  .catch((error) => {
    console.error('[auth-service] Legacy auth migration failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
