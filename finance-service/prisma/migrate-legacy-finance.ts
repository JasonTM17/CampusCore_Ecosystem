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

async function migrateLegacyFinance() {
  const hasInvoice = await tableExists('public', 'Invoice');
  const hasInvoiceItem = await tableExists('public', 'InvoiceItem');
  const hasPayment = await tableExists('public', 'Payment');
  const hasScholarship = await tableExists('public', 'Scholarship');
  const hasStudentScholarship = await tableExists(
    'public',
    'StudentScholarship',
  );

  if (!hasInvoice && !hasPayment && !hasScholarship && !hasStudentScholarship) {
    console.log(
      '[finance-service] No legacy finance tables found in public schema. Skipping migration.',
    );
    return;
  }

  if (hasScholarship) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "finance"."Scholarship" (
        "id", "name", "code", "description", "type", "value", "criteria",
        "isActive", "createdAt", "updatedAt"
      )
      SELECT
        s."id", s."name", s."code", s."description", s."type", s."value",
        s."criteria", s."isActive", s."createdAt", s."updatedAt"
      FROM "public"."Scholarship" s
      ON CONFLICT ("id") DO NOTHING
    `);
  }

  if (hasStudentScholarship) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "finance"."StudentScholarship" (
        "id", "studentId", "scholarshipId", "semesterId", "startDate",
        "endDate", "status", "createdAt", "updatedAt"
      )
      SELECT
        ss."id", ss."studentId", ss."scholarshipId", ss."semesterId",
        ss."startDate", ss."endDate", ss."status", ss."createdAt", ss."updatedAt"
      FROM "public"."StudentScholarship" ss
      ON CONFLICT ("id") DO NOTHING
    `);
  }

  if (hasInvoice) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "finance"."Invoice" (
        "id", "invoiceNumber", "studentId", "studentUserId", "studentDisplayName",
        "studentEmail", "studentCode", "semesterId", "semesterName", "semesterNameEn",
        "semesterNameVi", "status",
        "subtotal", "discount", "total", "dueDate", "paidAt", "notes",
        "createdAt", "updatedAt"
      )
      SELECT
        inv."id",
        inv."invoiceNumber",
        inv."studentId",
        COALESCE(stu."userId", inv."studentId") AS "studentUserId",
        COALESCE(NULLIF(trim(concat_ws(' ', usr."firstName", usr."lastName")), ''), inv."studentId") AS "studentDisplayName",
        COALESCE(usr."email", '') AS "studentEmail",
        COALESCE(stu."studentId", inv."studentId") AS "studentCode",
        inv."semesterId",
        COALESCE(sem."name", inv."semesterId") AS "semesterName",
        COALESCE(sem."nameEn", sem."name", inv."semesterId") AS "semesterNameEn",
        sem."nameVi" AS "semesterNameVi",
        inv."status"::text::"finance"."InvoiceStatus",
        inv."subtotal",
        inv."discount",
        inv."total",
        inv."dueDate",
        inv."paidAt",
        inv."notes",
        inv."createdAt",
        inv."updatedAt"
      FROM "public"."Invoice" inv
      LEFT JOIN "public"."Student" stu ON stu."id" = inv."studentId"
      LEFT JOIN "public"."User" usr ON usr."id" = stu."userId"
      LEFT JOIN "public"."Semester" sem ON sem."id" = inv."semesterId"
      ON CONFLICT ("id") DO NOTHING
    `);
  }

  if (hasInvoiceItem) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "finance"."InvoiceItem" (
        "id", "invoiceId", "description", "quantity", "unitPrice", "total"
      )
      SELECT
        ii."id", ii."invoiceId", ii."description", ii."quantity", ii."unitPrice", ii."total"
      FROM "public"."InvoiceItem" ii
      ON CONFLICT ("id") DO NOTHING
    `);
  }

  if (hasPayment) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "finance"."Payment" (
        "id", "paymentNumber", "invoiceId", "studentId", "amount", "method",
        "status", "paidAt", "transactionId", "notes", "createdAt", "updatedAt"
      )
      SELECT
        p."id", p."paymentNumber", p."invoiceId", p."studentId", p."amount", p."method",
        p."status"::text::"finance"."PaymentStatus", p."paidAt", p."transactionId",
        p."notes", p."createdAt", p."updatedAt"
      FROM "public"."Payment" p
      ON CONFLICT ("id") DO NOTHING
    `);
  }

  if (hasInvoice) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "finance"."Payment" (
        "id", "paymentNumber", "invoiceId", "studentId", "amount", "method",
        "status", "paidAt", "transactionId", "notes", "createdAt", "updatedAt"
      )
      SELECT
        inv."id" || '-legacy-payment',
        'PAY-LEGACY-' || regexp_replace(inv."invoiceNumber", '[^A-Za-z0-9]+', '', 'g'),
        inv."id",
        inv."studentId",
        inv."total",
        'BANK_TRANSFER',
        'COMPLETED'::"finance"."PaymentStatus",
        COALESCE(inv."paidAt", inv."updatedAt", inv."createdAt"),
        'legacy-sync-' || inv."id",
        'Backfilled payment history for a legacy paid invoice.',
        COALESCE(inv."paidAt", inv."createdAt"),
        COALESCE(inv."updatedAt", inv."createdAt")
      FROM "finance"."Invoice" inv
      WHERE inv."status" = 'PAID'::"finance"."InvoiceStatus"
        AND NOT EXISTS (
          SELECT 1
          FROM "finance"."Payment" pay
          WHERE pay."invoiceId" = inv."id"
            AND pay."status" = 'COMPLETED'::"finance"."PaymentStatus"
        )
      ON CONFLICT ("id") DO NOTHING
    `);
  }

  console.log('[finance-service] Legacy finance migration completed.');
}

migrateLegacyFinance()
  .catch((error) => {
    console.error('[finance-service] Legacy finance migration failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
