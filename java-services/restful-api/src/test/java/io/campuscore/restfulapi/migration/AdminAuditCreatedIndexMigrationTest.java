package io.campuscore.restfulapi.migration;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class AdminAuditCreatedIndexMigrationTest {
    private static final String MIGRATION = "/db/migration/V150__admin_audit_created_index.sql";
    private static final Pattern INDEX = Pattern.compile(
            "(?m)^CREATE INDEX IF NOT EXISTS (\\w+)\\s+ON campuscore_audit\\.\"AdminAudit\" \\(([^)]*)\\);");

    @Test
    void newestFirstOrderOfTheAuditScreenHasItsOwnIndex() throws IOException {
        String sql = read(MIGRATION);
        Matcher index = INDEX.matcher(sql);

        assertThat(index.find()).as("an index on campuscore_audit.\"AdminAudit\"").isTrue();
        assertThat(index.group(1)).isEqualTo("admin_audit_created_id_idx");
        assertThat(index.group(2).replaceAll("\\s+", " ").trim())
                .isEqualTo("\"createdAt\" DESC, \"id\" DESC");
        assertThat(index.find()).as("exactly one index definition").isFalse();
    }

    @Test
    void migrationNeverRewritesExistingData() throws IOException {
        String sql = read(MIGRATION).lines().filter(line -> !line.startsWith("--")).reduce("", String::concat).toUpperCase();

        assertThat(sql).doesNotContain("DROP ").doesNotContain("DELETE ").doesNotContain("UPDATE ");
        assertThat(sql).doesNotContain("CONCURRENTLY");
    }

    private static String read(String resource) throws IOException {
        try (InputStream stream = AdminAuditCreatedIndexMigrationTest.class.getResourceAsStream(resource)) {
            assertThat(stream).as(resource).isNotNull();
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
