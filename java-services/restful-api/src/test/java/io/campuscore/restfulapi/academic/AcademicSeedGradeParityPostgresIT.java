package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class AcademicSeedGradeParityPostgresIT {
    private static final String CANONICAL_LETTER = """
            CASE
                WHEN "finalGrade" >= 9.0 THEN 'A+'
                WHEN "finalGrade" >= 8.5 THEN 'A'
                WHEN "finalGrade" >= 8.0 THEN 'B+'
                WHEN "finalGrade" >= 7.0 THEN 'B'
                WHEN "finalGrade" >= 6.5 THEN 'C+'
                WHEN "finalGrade" >= 5.5 THEN 'C'
                WHEN "finalGrade" >= 5.0 THEN 'D+'
                WHEN "finalGrade" >= 4.0 THEN 'D'
                ELSE 'F'
            END
            """;

    @BeforeAll
    static void migrateFreshChain() {
        SeedPostgresITSupport.migrate();
    }

    @Test
    void generatedHistoryUsesCanonicalBandsAndKeepsLowerBandsStable() throws Exception {
        try (Connection connection = SeedPostgresITSupport.connect()) {
            assertThat(SeedPostgresITSupport.count(connection, """
                    SELECT COUNT(*) FROM academic."Enrollment"
                    WHERE ("id" LIKE 'enr-s2-hist-%' OR "id" LIKE 'enr-s3-hist-%')
                      AND "finalGrade" >= 9.0 AND "letterGrade" <> 'A+'
                    """)).isZero();
            assertThat(SeedPostgresITSupport.count(connection, """
                    SELECT COUNT(*) FROM academic."Enrollment"
                    WHERE ("id" LIKE 'enr-s2-hist-%' OR "id" LIKE 'enr-s3-hist-%')
                      AND "finalGrade" IS NOT NULL AND "letterGrade" IS DISTINCT FROM %s
                    """.replace("%s", CANONICAL_LETTER))).isZero();
            assertThat(SeedPostgresITSupport.count(connection, """
                    SELECT COUNT(*) FROM academic."Enrollment"
                    WHERE ("id" LIKE 'enr-s2-hist-%' OR "id" LIKE 'enr-s3-hist-%')
                      AND "finalGrade" < 9.0 AND "letterGrade" IS DISTINCT FROM CASE
                          WHEN "finalGrade" >= 8.5 THEN 'A'
                          WHEN "finalGrade" >= 8.0 THEN 'B+'
                          WHEN "finalGrade" >= 7.0 THEN 'B'
                          WHEN "finalGrade" >= 6.5 THEN 'C+'
                          WHEN "finalGrade" >= 5.5 THEN 'C'
                          WHEN "finalGrade" >= 4.0 THEN 'D'
                          ELSE 'F'
                      END
                    """)).isZero();
        }
    }
}
