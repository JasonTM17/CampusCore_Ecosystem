package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class HistoricalEnrollmentDatesPostgresIT {
    @BeforeAll
    static void migrateFreshChain() {
        SeedPostgresITSupport.migrate();
    }

    @Test
    void generatedHistoricalEnrollmentsStayWithinTheirSemester() throws Exception {
        try (Connection connection = SeedPostgresITSupport.connect()) {
            assertThat(SeedPostgresITSupport.count(connection, """
                    SELECT COUNT(*) FROM academic."Enrollment" enrollment
                    JOIN academic."Semester" semester ON semester."id" = enrollment."semesterId"
                    WHERE enrollment."id" LIKE 'enrollment-history-v27-%'
                      AND enrollment."enrolledAt" > semester."endDate"
                    """)).isZero();
        }
    }
}
