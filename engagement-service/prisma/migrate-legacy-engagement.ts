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

async function migrateLegacyEngagement() {
  const hasAnnouncement = await tableExists('public', 'Announcement');
  const hasSupportTicket = await tableExists('public', 'SupportTicket');
  const hasTicketResponse = await tableExists('public', 'TicketResponse');

  if (!hasAnnouncement && !hasSupportTicket && !hasTicketResponse) {
    console.log(
      '[engagement-service] No legacy engagement tables found in public schema. Skipping migration.',
    );
    return;
  }

  if (hasAnnouncement) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "engagement"."Announcement" (
        "id", "title", "content", "priority", "targetRoles", "targetYears",
        "isGlobal", "publishAt", "expiresAt", "publishedBy", "semesterId",
        "semesterName", "sectionId", "sectionNumber", "courseCode",
        "courseName", "lecturerId", "lecturerDisplayName", "createdAt", "updatedAt"
      )
      SELECT
        a."id",
        a."title",
        a."content",
        a."priority",
        a."targetRoles",
        a."targetYears",
        a."isGlobal",
        a."publishAt",
        a."expiresAt",
        a."publishedBy",
        a."semesterId",
        sem."name" AS "semesterName",
        a."sectionId",
        sec."sectionNumber",
        c."code" AS "courseCode",
        c."name" AS "courseName",
        a."lecturerId",
        NULLIF(trim(concat_ws(' ', lu."firstName", lu."lastName")), '') AS "lecturerDisplayName",
        a."createdAt",
        a."updatedAt"
      FROM "public"."Announcement" a
      LEFT JOIN "public"."Semester" sem ON sem."id" = a."semesterId"
      LEFT JOIN "public"."Section" sec ON sec."id" = a."sectionId"
      LEFT JOIN "public"."Course" c ON c."id" = sec."courseId"
      LEFT JOIN "public"."Lecturer" lec ON lec."id" = a."lecturerId"
      LEFT JOIN "public"."User" lu ON lu."id" = lec."userId"
      ON CONFLICT ("id") DO NOTHING
    `);
  }

  if (hasSupportTicket) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "engagement"."SupportTicket" (
        "id", "ticketNumber", "userId", "userEmail", "userDisplayName",
        "subject", "description", "category", "priority", "status",
        "assignedTo", "assignedToDisplayName", "resolvedAt", "closedAt",
        "createdAt", "updatedAt"
      )
      SELECT
        st."id",
        st."ticketNumber",
        st."userId",
        COALESCE(u."email", '') AS "userEmail",
        NULLIF(trim(concat_ws(' ', u."firstName", u."lastName")), '') AS "userDisplayName",
        st."subject",
        st."description",
        st."category",
        st."priority"::text::"engagement"."TicketPriority",
        st."status"::text::"engagement"."TicketStatus",
        st."assignedTo",
        NULLIF(trim(concat_ws(' ', au."firstName", au."lastName")), '') AS "assignedToDisplayName",
        st."resolvedAt",
        st."closedAt",
        st."createdAt",
        st."updatedAt"
      FROM "public"."SupportTicket" st
      LEFT JOIN "public"."User" u ON u."id" = st."userId"
      LEFT JOIN "public"."User" au ON au."id" = st."assignedTo"
      ON CONFLICT ("id") DO NOTHING
    `);
  }

  if (hasTicketResponse) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "engagement"."TicketResponse" (
        "id", "ticketId", "userId", "userEmail", "userDisplayName",
        "message", "isInternal", "createdAt"
      )
      SELECT
        tr."id",
        tr."ticketId",
        tr."userId",
        COALESCE(u."email", '') AS "userEmail",
        NULLIF(trim(concat_ws(' ', u."firstName", u."lastName")), '') AS "userDisplayName",
        tr."message",
        tr."isInternal",
        tr."createdAt"
      FROM "public"."TicketResponse" tr
      LEFT JOIN "public"."User" u ON u."id" = tr."userId"
      ON CONFLICT ("id") DO NOTHING
    `);
  }

  console.log('[engagement-service] Legacy engagement migration completed.');
}

migrateLegacyEngagement()
  .catch((error) => {
    console.error(
      '[engagement-service] Legacy engagement migration failed',
      error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
