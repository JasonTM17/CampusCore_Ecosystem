package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class GeneratedScheduleSeedIntegrityPostgresIT {
    @BeforeAll
    static void migrateFreshChain() {
        SeedPostgresITSupport.migrate();
    }

    @Test
    void generatedSectionsHaveUniqueRoomsAndNoLecturerOverlap() throws Exception {
        try (Connection connection = SeedPostgresITSupport.connect()) {
            assertThat(SeedPostgresITSupport.count(connection, """
                    SELECT COUNT(*) FROM (
                        SELECT schedule."classroomId", schedule."dayOfWeek", schedule."startTime"
                        FROM academic."Section" section
                        JOIN academic."SectionSchedule" schedule ON schedule."sectionId" = section."id"
                        WHERE section."id" LIKE 'section-auto-%'
                        GROUP BY schedule."classroomId", schedule."dayOfWeek", schedule."startTime"
                        HAVING COUNT(*) > 1
                    ) duplicates
                    """)).isZero();
            assertThat(SeedPostgresITSupport.count(connection, """
                    SELECT COUNT(*)
                    FROM academic."Section" first_section
                    JOIN academic."SectionSchedule" first_schedule ON first_schedule."sectionId" = first_section."id"
                    JOIN academic."Section" second_section
                      ON second_section."id" > first_section."id"
                     AND second_section."lecturerId" = first_section."lecturerId"
                     AND second_section."id" LIKE 'section-auto-%'
                    JOIN academic."SectionSchedule" second_schedule ON second_schedule."sectionId" = second_section."id"
                    WHERE first_section."id" LIKE 'section-auto-%'
                      AND first_schedule."dayOfWeek" = second_schedule."dayOfWeek"
                      AND first_schedule."startTime"::time < second_schedule."endTime"::time
                      AND second_schedule."startTime"::time < first_schedule."endTime"::time
                    """)).isZero();
        }
    }
}
