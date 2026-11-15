-- V166: RegistrationWish — đăng ký nguyện vọng (PTIT/UEF-style course
-- wishlist). A student declares intent to take a course in a semester; the
-- dedicated registration page surfaces wishes beside the catalog so a full
-- section or an unmet prerequisite does not lose the student's plan.
--
-- Idempotent on (student, course, semester): a duplicate intent is a 409, and
-- the unique constraint is also the backstop when two requests race.
CREATE TABLE academic."RegistrationWish" (
    "id"         VARCHAR(120)             NOT NULL,
    "studentId"  VARCHAR(120)             NOT NULL,
    "courseId"   VARCHAR(120)             NOT NULL,
    "semesterId" VARCHAR(120)             NOT NULL,
    "createdAt"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RegistrationWish_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_registration_wish_student_course_semester"
        UNIQUE ("studentId", "courseId", "semesterId"),
    CONSTRAINT "fk_registration_wish_student"
        FOREIGN KEY ("studentId") REFERENCES academic."Student"("id") ON DELETE CASCADE,
    CONSTRAINT "fk_registration_wish_course"
        FOREIGN KEY ("courseId") REFERENCES academic."Course"("id"),
    CONSTRAINT "fk_registration_wish_semester"
        FOREIGN KEY ("semesterId") REFERENCES academic."Semester"("id")
);

CREATE INDEX "idx_registration_wish_student_semester"
    ON academic."RegistrationWish" ("studentId", "semesterId");
