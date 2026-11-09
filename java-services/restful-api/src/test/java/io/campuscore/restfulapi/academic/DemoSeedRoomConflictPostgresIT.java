package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class DemoSeedRoomConflictPostgresIT {
    @BeforeAll
    static void migrateFreshChain() {
        SeedPostgresITSupport.migrate();
    }

    @Test
    void seededSectionsDoNotHaveRoomOverlapsWithinTheirSemester() throws Exception {
        try (Connection connection = SeedPostgresITSupport.connect()) {
            int equalStartPairs = SeedPostgresITSupport.count(connection, """
                    SELECT COUNT(*)
                    FROM academic."SectionSchedule" first_schedule
                    JOIN academic."Section" first_section ON first_section."id" = first_schedule."sectionId"
                    JOIN academic."SectionSchedule" second_schedule
                      ON second_schedule."classroomId" = first_schedule."classroomId"
                     AND second_schedule."dayOfWeek" = first_schedule."dayOfWeek"
                     AND second_schedule."startTime" = first_schedule."startTime"
                     AND second_schedule."sectionId" > first_schedule."sectionId"
                    JOIN academic."Section" second_section ON second_section."id" = second_schedule."sectionId"
                    WHERE first_section."semesterId" = second_section."semesterId"
                      AND first_section."status" <> 'CANCELLED'
                      AND second_section."status" <> 'CANCELLED'
                      AND (first_section."id" LIKE 'section-auto-%' OR second_section."id" LIKE 'section-auto-%')
                      AND (first_section."id" LIKE 'section-auto-%' OR first_section."id" LIKE 'section-%-demo%'
                        OR first_section."id" LIKE 'section-demo-%')
                      AND (second_section."id" LIKE 'section-auto-%' OR second_section."id" LIKE 'section-%-demo%'
                        OR second_section."id" LIKE 'section-demo-%')
                    """);
            int allOverlapPairs = SeedPostgresITSupport.count(connection, """
                    SELECT COUNT(*)
                    FROM academic."SectionSchedule" first_schedule
                    JOIN academic."Section" first_section ON first_section."id" = first_schedule."sectionId"
                    JOIN academic."SectionSchedule" second_schedule
                      ON second_schedule."classroomId" = first_schedule."classroomId"
                     AND second_schedule."dayOfWeek" = first_schedule."dayOfWeek"
                     AND second_schedule."startTime" < first_schedule."endTime"
                     AND second_schedule."endTime" > first_schedule."startTime"
                     AND second_schedule."sectionId" > first_schedule."sectionId"
                    JOIN academic."Section" second_section ON second_section."id" = second_schedule."sectionId"
                    WHERE first_section."semesterId" = second_section."semesterId"
                      AND first_section."status" <> 'CANCELLED'
                      AND second_section."status" <> 'CANCELLED'
                      AND (first_section."id" LIKE 'section-auto-%' OR second_section."id" LIKE 'section-auto-%')
                      AND (first_section."id" LIKE 'section-auto-%' OR first_section."id" LIKE 'section-%-demo%'
                        OR first_section."id" LIKE 'section-demo-%')
                      AND (second_section."id" LIKE 'section-auto-%' OR second_section."id" LIKE 'section-%-demo%'
                        OR second_section."id" LIKE 'section-demo-%')
                    """);
            int generatedOverlapPairs = SeedPostgresITSupport.count(connection, """
                    SELECT COUNT(*)
                    FROM academic."SectionSchedule" first_schedule
                    JOIN academic."Section" first_section ON first_section."id" = first_schedule."sectionId"
                    JOIN academic."SectionSchedule" second_schedule
                      ON second_schedule."classroomId" = first_schedule."classroomId"
                     AND second_schedule."dayOfWeek" = first_schedule."dayOfWeek"
                     AND second_schedule."startTime" < first_schedule."endTime"
                     AND second_schedule."endTime" > first_schedule."startTime"
                     AND second_schedule."sectionId" > first_schedule."sectionId"
                    JOIN academic."Section" second_section ON second_section."id" = second_schedule."sectionId"
                    WHERE first_section."semesterId" = second_section."semesterId"
                      AND first_section."status" <> 'CANCELLED'
                      AND second_section."status" <> 'CANCELLED'
                      AND first_section."id" LIKE 'section-auto-%'
                      AND second_section."id" LIKE 'section-auto-%'
                    """);
            int generatedHandWrittenPairs = SeedPostgresITSupport.count(connection, """
                    SELECT COUNT(*)
                    FROM academic."SectionSchedule" first_schedule
                    JOIN academic."Section" first_section ON first_section."id" = first_schedule."sectionId"
                    JOIN academic."SectionSchedule" second_schedule
                      ON second_schedule."classroomId" = first_schedule."classroomId"
                     AND second_schedule."dayOfWeek" = first_schedule."dayOfWeek"
                     AND second_schedule."startTime" < first_schedule."endTime"
                     AND second_schedule."endTime" > first_schedule."startTime"
                     AND second_schedule."sectionId" > first_schedule."sectionId"
                    JOIN academic."Section" second_section ON second_section."id" = second_schedule."sectionId"
                    WHERE first_section."semesterId" = second_section."semesterId"
                      AND first_section."status" <> 'CANCELLED'
                      AND second_section."status" <> 'CANCELLED'
                      AND ((first_section."id" LIKE 'section-auto-%' AND (second_section."id" LIKE 'section-%-demo%'
                            OR second_section."id" LIKE 'section-demo-%'))
                        OR (second_section."id" LIKE 'section-auto-%' AND (first_section."id" LIKE 'section-%-demo%'
                            OR first_section."id" LIKE 'section-demo-%')))
                    """);
            int classroomMismatches = SeedPostgresITSupport.count(connection, """
                    SELECT COUNT(*)
                    FROM academic."Section" section
                    JOIN academic."SectionSchedule" schedule ON schedule."sectionId" = section."id"
                    WHERE section."id" LIKE 'section-auto-%'
                      AND section."classroomId" IS DISTINCT FROM schedule."classroomId"
                    """);
            int durationMismatches = SeedPostgresITSupport.count(connection, """
                    SELECT COUNT(*) FROM academic."SectionSchedule"
                    WHERE "sectionId" LIKE 'section-auto-%'
                      AND ("endTime"::time - "startTime"::time) <> INTERVAL '2 hours 30 minutes'
                    """);
            System.out.printf("Seed room pairs in migrated chain: equal-start=%d, interval-overlap=%d, generated=%d, generated-to-handwritten=%d%n",
                    equalStartPairs, allOverlapPairs, generatedOverlapPairs, generatedHandWrittenPairs);
            assertThat(allOverlapPairs)
                    .as("seed room interval-overlap pairs: equal-start=%d, generated=%d, generated-to-handwritten=%d",
                            equalStartPairs, generatedOverlapPairs, generatedHandWrittenPairs)
                    .isZero();
            assertThat(classroomMismatches).isZero();
            assertThat(durationMismatches).isZero();
        }
    }

    @Test
    void seededGeneratedLecturersDoNotOverlapAnySeededSectionWithinTheirSemester() throws Exception {
        try (Connection connection = SeedPostgresITSupport.connect()) {
            int lecturerOverlapPairs = SeedPostgresITSupport.count(connection, """
                    SELECT COUNT(*)
                    FROM academic."Section" generated_section
                    JOIN academic."SectionSchedule" generated_schedule ON generated_schedule."sectionId" = generated_section."id"
                    JOIN academic."Section" other_section
                      ON other_section."id" <> generated_section."id"
                     AND other_section."semesterId" = generated_section."semesterId"
                     AND other_section."lecturerId" = generated_section."lecturerId"
                    JOIN academic."SectionSchedule" other_schedule ON other_schedule."sectionId" = other_section."id"
                    WHERE generated_section."id" LIKE 'section-auto-%'
                      AND generated_section."status" <> 'CANCELLED'
                      AND other_section."status" <> 'CANCELLED'
                      AND (other_section."id" LIKE 'section-auto-%' OR other_section."id" LIKE 'section-%-demo%'
                        OR other_section."id" LIKE 'section-demo-%')
                      AND (generated_section."id" < other_section."id" OR other_section."id" NOT LIKE 'section-auto-%')
                      AND generated_schedule."dayOfWeek" = other_schedule."dayOfWeek"
                      AND generated_schedule."startTime"::time < other_schedule."endTime"::time
                      AND other_schedule."startTime"::time < generated_schedule."endTime"::time
                    """);
            System.out.printf("Seed lecturer interval-overlap pairs: %d%n", lecturerOverlapPairs);
            assertThat(lecturerOverlapPairs).as("seed lecturer interval-overlap pairs").isZero();
        }
    }

    @Test
    void rerunningAllocatorDoesNotChangeGeneratedSchedules() throws Exception {
        try (Connection connection = SeedPostgresITSupport.connect();
             Statement statement = connection.createStatement()) {
            String before = generatedScheduleState(connection);
            String migration;
            try (var resource = getClass().getResourceAsStream("/db/migration/V162__dedupe_generated_schedule_room_conflicts.sql")) {
                assertThat(resource).isNotNull();
                migration = new String(resource.readAllBytes(), StandardCharsets.UTF_8);
            }
            statement.execute(migration);
            assertThat(generatedScheduleState(connection)).isEqualTo(before);
        }
    }

    private static String generatedScheduleState(Connection connection) throws Exception {
        try (Statement statement = connection.createStatement();
             ResultSet rows = statement.executeQuery("""
                     SELECT string_agg(
                         concat_ws('|', section."id", section."classroomId", schedule."id",
                                   schedule."classroomId", schedule."dayOfWeek", schedule."startTime", schedule."endTime"),
                         E'\\n' ORDER BY section."id", schedule."id")
                     FROM academic."Section" section
                     JOIN academic."SectionSchedule" schedule ON schedule."sectionId" = section."id"
                     WHERE section."id" LIKE 'section-auto-%'
                     """)) {
            if (!rows.next()) throw new IllegalStateException("Generated schedule snapshot returned no row");
            return rows.getString(1);
        }
    }
}
