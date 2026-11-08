package io.campuscore.restfulapi.thesis.assistant;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Migration validation test for Flyway V160:
 * V160__correct_gpa_letter_conversion_bands.sql
 *
 * The assistant corpus must document the same 10-point letter bands the
 * application assigns: A+ for 9.0-10.0 and A for 8.5-8.9, never a single
 * 8.5-10.0 A band with no A+.
 */
class GpaLetterConversionBandMigrationTest {

    private static final Path MIGRATION_PATH =
            Path.of("src/main/resources/db/migration/V160__correct_gpa_letter_conversion_bands.sql");
    private static String sql;

    @BeforeAll
    static void loadMigrationSql() throws Exception {
        assertThat(MIGRATION_PATH)
                .as("Flyway migration V160 file must exist at expected path")
                .exists();
        sql = Files.readString(MIGRATION_PATH);
        assertThat(sql).isNotBlank();
    }

    @Test
    @DisplayName("V160 targets the curriculum document and the conversion FAQ in both locales")
    void v160TargetsEveryAffectedDocument() {
        assertThat(sql)
                .contains("curriculum-gpa-weighting-and-credit-system-vi")
                .contains("curriculum-gpa-weighting-and-credit-system-en")
                .contains("gpa-letter-conversion-faq-vi")
                .contains("gpa-letter-conversion-faq-en");
    }

    @Test
    @DisplayName("V160 publishes the application A+ band and the corrected A band")
    void v160PublishesTheApplicationLetterBands() {
        assertThat(sql)
                .contains("9.0-10.0")
                .contains("8.5-8.9")
                .contains("A+");
    }

    @Test
    @DisplayName("V160 does not document the old 8.5-10.0 grade-A band")
    void v160DoesNotDocumentThePreAPlusBand() {
        assertThat(sql)
                .doesNotContain("8.5-10.0 = A")
                .doesNotContain("8.5-10.0 tương ứng loại A");
    }
}
