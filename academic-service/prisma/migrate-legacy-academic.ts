import { PrismaClient } from '@prisma/client';

function getTargetSchema(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const schema = parsed.searchParams.get('schema') ?? 'academic';

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(schema)) {
    throw new Error(`Unsupported schema name for migration: ${schema}`);
  }

  return schema;
}

async function tableExists(
  prisma: PrismaClient,
  schema: string,
  table: string,
) {
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

async function main() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const prisma = new PrismaClient();
  const targetSchema = getTargetSchema(databaseUrl);

  try {
    const requiredTables = [
      'User',
      'Faculty',
      'Department',
      'AcademicYear',
      'Semester',
      'Course',
      'CoursePrerequisite',
      'Curriculum',
      'CurriculumCourse',
      'Lecturer',
      'Student',
      'Classroom',
      'Section',
      'SectionSchedule',
      'Enrollment',
      'Waitlist',
      'Attendance',
      'GradeItem',
      'StudentGrade',
    ];

    const existing = new Map<string, boolean>();

    for (const table of requiredTables) {
      existing.set(table, await tableExists(prisma, 'public', table));
    }

    if (
      !existing.get('Student') &&
      !existing.get('Section') &&
      !existing.get('Enrollment')
    ) {
      console.log(
        '[academic-service] No legacy academic tables found in public schema. Skipping migration.',
      );
      return;
    }

    if (
      existing.get('User') &&
      (existing.get('Student') || existing.get('Lecturer'))
    ) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${targetSchema}"."User" (
          "id", "email", "firstName", "lastName", "phone", "gender",
          "dateOfBirth", "address", "avatar", "status", "createdAt", "updatedAt"
        )
        SELECT DISTINCT
          u."id",
          u."email",
          u."firstName",
          u."lastName",
          u."phone",
          CASE
            WHEN u."gender" IS NULL THEN NULL
            ELSE u."gender"::text::"${targetSchema}"."Gender"
          END,
          u."dateOfBirth",
          u."address",
          u."avatar",
          u."status"::text::"${targetSchema}"."UserStatus",
          u."createdAt",
          u."updatedAt"
        FROM "public"."User" u
        WHERE u."id" IN (
          SELECT "userId" FROM "public"."Student"
          UNION
          SELECT "userId" FROM "public"."Lecturer"
        )
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    if (existing.get('Faculty')) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${targetSchema}"."Faculty" (
          "id", "name", "code", "description", "dean", "phone", "email",
          "building", "createdAt", "updatedAt", "isActive"
        )
        SELECT
          "id", "name", "code", "description", "dean", "phone", "email",
          "building", "createdAt", "updatedAt", "isActive"
        FROM "public"."Faculty"
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    if (existing.get('Department')) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${targetSchema}"."Department" (
          "id", "name", "code", "description", "chair", "phone", "email",
          "building", "facultyId", "createdAt", "updatedAt", "isActive"
        )
        SELECT
          "id", "name", "code", "description", "chair", "phone", "email",
          "building", "facultyId", "createdAt", "updatedAt", "isActive"
        FROM "public"."Department"
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    if (existing.get('AcademicYear')) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${targetSchema}"."AcademicYear" (
          "id", "year", "startDate", "endDate", "isCurrent", "createdAt", "updatedAt"
        )
        SELECT
          "id", "year", "startDate", "endDate", "isCurrent", "createdAt", "updatedAt"
        FROM "public"."AcademicYear"
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    if (existing.get('Semester')) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${targetSchema}"."Semester" (
          "id", "name", "type", "academicYearId", "startDate", "endDate",
          "registrationStart", "registrationEnd", "addDropStart", "addDropEnd",
          "status", "createdAt", "updatedAt"
        )
        SELECT
          "id", "name", "type", "academicYearId", "startDate", "endDate",
          "registrationStart", "registrationEnd", "addDropStart", "addDropEnd",
          "status"::text::"${targetSchema}"."SemesterStatus",
          "createdAt", "updatedAt"
        FROM "public"."Semester"
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    if (existing.get('Course')) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${targetSchema}"."Course" (
          "id", "code", "name", "description", "credits", "departmentId",
          "semesterId", "isActive", "createdAt", "updatedAt"
        )
        SELECT
          "id", "code", "name", "description", "credits", "departmentId",
          "semesterId", "isActive", "createdAt", "updatedAt"
        FROM "public"."Course"
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    if (existing.get('CoursePrerequisite')) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${targetSchema}"."CoursePrerequisite" (
          "id", "courseId", "prerequisiteId", "isCorequisite", "createdAt"
        )
        SELECT
          "id", "courseId", "prerequisiteId", "isCorequisite", "createdAt"
        FROM "public"."CoursePrerequisite"
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    if (existing.get('Curriculum')) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${targetSchema}"."Curriculum" (
          "id", "name", "code", "departmentId", "academicYearId", "semesterId",
          "totalCredits", "description", "isActive", "createdAt", "updatedAt"
        )
        SELECT
          "id", "name", "code", "departmentId", "academicYearId", "semesterId",
          "totalCredits", "description", "isActive", "createdAt", "updatedAt"
        FROM "public"."Curriculum"
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    if (existing.get('CurriculumCourse')) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${targetSchema}"."CurriculumCourse" (
          "id", "curriculumId", "courseId", "year", "semester", "isMandatory"
        )
        SELECT
          "id", "curriculumId", "courseId", "year", "semester", "isMandatory"
        FROM "public"."CurriculumCourse"
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    if (existing.get('Lecturer')) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${targetSchema}"."Lecturer" (
          "id", "userId", "departmentId", "employeeId", "title", "specialization",
          "office", "phone", "createdAt", "updatedAt", "isActive"
        )
        SELECT
          "id", "userId", "departmentId", "employeeId", "title", "specialization",
          "office", "phone", "createdAt", "updatedAt", "isActive"
        FROM "public"."Lecturer"
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    if (existing.get('Student')) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${targetSchema}"."Student" (
          "id", "userId", "studentId", "curriculumId", "year", "status",
          "admissionDate", "createdAt", "updatedAt"
        )
        SELECT
          "id", "userId", "studentId", "curriculumId", "year", "status",
          "admissionDate", "createdAt", "updatedAt"
        FROM "public"."Student"
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    if (existing.get('Classroom')) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${targetSchema}"."Classroom" (
          "id", "building", "roomNumber", "capacity", "type", "equipment",
          "isActive", "createdAt", "updatedAt"
        )
        SELECT
          "id", "building", "roomNumber", "capacity", "type", "equipment",
          "isActive", "createdAt", "updatedAt"
        FROM "public"."Classroom"
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    if (existing.get('Section')) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${targetSchema}"."Section" (
          "id", "sectionNumber", "courseId", "semesterId", "lecturerId",
          "classroomId", "capacity", "enrolledCount", "status", "maxCredits",
          "createdAt", "updatedAt"
        )
        SELECT
          "id", "sectionNumber", "courseId", "semesterId", "lecturerId",
          "classroomId", "capacity", "enrolledCount", "status", "maxCredits",
          "createdAt", "updatedAt"
        FROM "public"."Section"
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    if (existing.get('SectionSchedule')) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${targetSchema}"."SectionSchedule" (
          "id", "sectionId", "classroomId", "dayOfWeek", "startTime", "endTime"
        )
        SELECT
          "id", "sectionId", "classroomId", "dayOfWeek", "startTime", "endTime"
        FROM "public"."SectionSchedule"
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    if (existing.get('Enrollment')) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${targetSchema}"."Enrollment" (
          "id", "studentId", "sectionId", "semesterId", "status", "enrolledAt",
          "droppedAt", "gradeStatus", "finalGrade", "letterGrade", "createdAt", "updatedAt"
        )
        SELECT
          "id", "studentId", "sectionId", "semesterId",
          "status"::text::"${targetSchema}"."EnrollmentStatus",
          "enrolledAt", "droppedAt",
          "gradeStatus"::text::"${targetSchema}"."GradeStatus",
          "finalGrade", "letterGrade", "createdAt", "updatedAt"
        FROM "public"."Enrollment"
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    if (existing.get('Waitlist')) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${targetSchema}"."Waitlist" (
          "id", "studentId", "sectionId", "position", "status", "addedAt", "convertedAt"
        )
        SELECT
          "id", "studentId", "sectionId", "position",
          "status"::text::"${targetSchema}"."WaitlistStatus",
          "addedAt", "convertedAt"
        FROM "public"."Waitlist"
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    if (existing.get('Attendance')) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${targetSchema}"."Attendance" (
          "id", "studentId", "sectionId", "date", "status", "notes", "createdAt"
        )
        SELECT
          "id", "studentId", "sectionId", "date",
          "status"::text::"${targetSchema}"."AttendanceStatus",
          "notes", "createdAt"
        FROM "public"."Attendance"
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    if (existing.get('GradeItem')) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${targetSchema}"."GradeItem" (
          "id", "sectionId", "name", "type", "maxScore", "weight",
          "gradedAt", "createdAt", "updatedAt", "courseId"
        )
        SELECT
          "id", "sectionId", "name", "type", "maxScore", "weight",
          "gradedAt", "createdAt", "updatedAt", "courseId"
        FROM "public"."GradeItem"
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    if (existing.get('StudentGrade')) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${targetSchema}"."StudentGrade" (
          "id", "gradeItemId", "enrollmentId", "score", "createdAt", "updatedAt"
        )
        SELECT
          "id", "gradeItemId", "enrollmentId", "score", "createdAt", "updatedAt"
        FROM "public"."StudentGrade"
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    console.log(
      `[academic-service] Legacy academic migration completed into schema "${targetSchema}".`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[academic-service] Legacy academic migration failed', error);
  process.exit(1);
});
