package io.campuscore.restfulapi.migration;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class EnrollmentSemesterIndexMigrationTest {
    private static final String MIGRATION = "/db/migration/V149__enrollment_semester_index.sql";
    private static final Pattern INDEX = Pattern.compile(
            "(?m)^CREATE INDEX IF NOT EXISTS (\\w+)\\s+ON academic\\.\"Enrollment\" \\(([^)]*)\\);");

    @Test
    void semesterLeadsTheEnrollmentIndexThatServesTheAdminListAndCount() throws IOException {
        String sql = read(MIGRATION);
        Matcher index = INDEX.matcher(sql);

        assertThat(index.find()).as("an index on academic.\"Enrollment\"").isTrue();
        assertThat(index.group(1)).isEqualTo("academic_enrollment_semester_enrolled_idx");
        assertThat(index.group(2).replaceAll("\\s+", " ").trim())
                .isEqualTo("\"semesterId\", \"enrolledAt\" DESC, \"id\" DESC");
        assertThat(index.find()).as("exactly one index definition").isFalse();
    }

    @Test
    void migrationNeverRewritesExistingData() throws IOException {
        String sql = read(MIGRATION).lines().filter(line -> !line.startsWith("--")).reduce("", String::concat).toUpperCase();

        assertThat(sql).doesNotContain("DROP ").doesNotContain("DELETE ").doesNotContain("UPDATE ");
        assertThat(sql).doesNotContain("CONCURRENTLY");
    }

    private static String read(String resource) throws IOException {
        try (InputStream stream = EnrollmentSemesterIndexMigrationTest.class.getResourceAsStream(resource)) {
            assertThat(stream).as(resource).isNotNull();
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
