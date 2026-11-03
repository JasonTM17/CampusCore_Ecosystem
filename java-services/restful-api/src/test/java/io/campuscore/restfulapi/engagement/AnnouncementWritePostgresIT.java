package io.campuscore.restfulapi.engagement;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.engagement.repository.AnnouncementWriteRepository;
import io.campuscore.restfulapi.engagement.repository.AnnouncementWriteRepository.PatchValue;
import io.campuscore.restfulapi.engagement.repository.AnnouncementWriteRepository.UpdateAnnouncementCommand;
import io.campuscore.restfulapi.engagement.web.AnnouncementReadDtos.AnnouncementResponse;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Real-PostgreSQL port of the derived-name clearing in
 * {@link AnnouncementWritePersistenceTest}. The H2 twin cannot prove the
 * {@code CASE WHEN "ownerId" IS DISTINCT FROM ?} expression binds correctly on
 * PostgreSQL, where an untyped or mistyped parameter inside CASE is a real
 * failure mode — this suite runs the production Flyway schema and binds both
 * {@code setString} and {@code setNull(VARCHAR)} variants.
 *
 * <p><b>Environment contract</b> (opt-in, same as the sibling {@code *PostgresIT}
 * classes): runs ONLY when {@code CAMPUSCORE_E2E_POSTGRES_URL} is a
 * {@code jdbc:postgresql:} URL pointing at a disposable database - the real
 * migrations run on context startup. Optional
 * {@code CAMPUSCORE_E2E_POSTGRES_USER} / {@code CAMPUSCORE_E2E_POSTGRES_PASSWORD}.
 * Fixture ids carry an {@code awpg-} marker and are removed after every test.
 */
@EnabledIf("postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "spring.jpa.hibernate.ddl-auto=none"
})
@ActiveProfiles({"test", "persistence"})
class AnnouncementWritePostgresIT {

    private static final Instant BASE_TIME = Instant.parse("2026-08-20T00:00:00Z");

    @Autowired
    private AnnouncementWriteRepository announcements;

    @Autowired
    private NamedParameterJdbcTemplate jdbc;

    private String tag;

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> valueOr(
                "CAMPUSCORE_E2E_POSTGRES_URL", "jdbc:postgresql://localhost:5432/campuscore_e2e"));
        registry.add("spring.datasource.username", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_USER", "postgres"));
        registry.add("spring.datasource.password", () -> valueOr("CAMPUSCORE_E2E_POSTGRES_PASSWORD", "postgres"));
    }

    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return url != null && url.startsWith("jdbc:postgresql:");
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    @BeforeEach
    void prepare() {
        tag = "awpg-" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }

    @AfterEach
    void cleanFixtures() {
        jdbc.update("DELETE FROM engagement.\"Announcement\" WHERE \"id\" LIKE :pattern",
                new MapSqlParameterSource("pattern", tag + "-%"));
    }

    @Test
    void updateKeepsDerivedNamesWhenAcademicScopeIsUnchanged() {
        String id = seedAnnouncement("unchanged");

        int changed = announcements.update(updateCommand(
                id,
                PatchValue.present("Typo fix"),
                PatchValue.present("semester-1"),
                PatchValue.present("section-1"),
                PatchValue.present("lecturer-1")));

        assertThat(changed).isEqualTo(1);
        AnnouncementResponse row = announcements.findById(id).orElseThrow();
        assertThat(row.title()).isEqualTo("Typo fix");
        assertThat(row.semesterId()).isEqualTo("semester-1");
        assertThat(row.semesterName()).isEqualTo("Semester 1");
        assertThat(row.sectionId()).isEqualTo("section-1");
        assertThat(row.sectionNumber()).isEqualTo("01");
        assertThat(row.courseCode()).isEqualTo("CS101");
        assertThat(row.courseName()).isEqualTo("Web Programming");
        assertThat(row.lecturerId()).isEqualTo("lecturer-1");
        assertThat(row.lecturerDisplayName()).isEqualTo("Lecturer One");
        assertThat(row.version()).isEqualTo(1);
    }

    @Test
    void changingSectionIdClearsDerivedSectionAndCourseNames() {
        String id = seedAnnouncement("resection");

        int changed = announcements.update(updateCommand(
                id,
                PatchValue.present("Moved to another section"),
                PatchValue.present("semester-1"),
                PatchValue.present("section-2"),
                PatchValue.present("lecturer-1")));

        assertThat(changed).isEqualTo(1);
        AnnouncementResponse row = announcements.findById(id).orElseThrow();
        assertThat(row.semesterId()).isEqualTo("semester-1");
        assertThat(row.semesterName()).isEqualTo("Semester 1");
        assertThat(row.sectionId()).isEqualTo("section-2");
        assertThat(row.sectionNumber()).isNull();
        assertThat(row.courseCode()).isNull();
        assertThat(row.courseName()).isNull();
        assertThat(row.lecturerId()).isEqualTo("lecturer-1");
        assertThat(row.lecturerDisplayName()).isEqualTo("Lecturer One");
        assertThat(row.version()).isEqualTo(1);
    }

    @Test
    void explicitNullOwnerIdsClearTheirDerivedNames() {
        String id = seedAnnouncement("explicit-null");

        int changed = announcements.update(updateCommand(
                id,
                PatchValue.present("Scope removed"),
                PatchValue.present(null),
                PatchValue.present(null),
                PatchValue.present(null)));

        assertThat(changed).isEqualTo(1);
        AnnouncementResponse row = announcements.findById(id).orElseThrow();
        assertThat(row.semesterId()).isNull();
        assertThat(row.semesterName()).isNull();
        assertThat(row.sectionId()).isNull();
        assertThat(row.sectionNumber()).isNull();
        assertThat(row.courseCode()).isNull();
        assertThat(row.courseName()).isNull();
        assertThat(row.lecturerId()).isNull();
        assertThat(row.lecturerDisplayName()).isNull();
        assertThat(row.version()).isEqualTo(1);
    }

    @Test
    void omittedOwnerIdsLeaveIdsAndDerivedNamesUntouched() {
        String id = seedAnnouncement("omitted");

        int changed = announcements.update(updateCommand(
                id,
                PatchValue.present("Body only edit"),
                PatchValue.omitted(),
                PatchValue.omitted(),
                PatchValue.omitted()));

        assertThat(changed).isEqualTo(1);
        AnnouncementResponse row = announcements.findById(id).orElseThrow();
        assertThat(row.title()).isEqualTo("Body only edit");
        assertThat(row.semesterId()).isEqualTo("semester-1");
        assertThat(row.semesterName()).isEqualTo("Semester 1");
        assertThat(row.sectionId()).isEqualTo("section-1");
        assertThat(row.sectionNumber()).isEqualTo("01");
        assertThat(row.courseCode()).isEqualTo("CS101");
        assertThat(row.courseName()).isEqualTo("Web Programming");
        assertThat(row.lecturerId()).isEqualTo("lecturer-1");
        assertThat(row.lecturerDisplayName()).isEqualTo("Lecturer One");
        assertThat(row.version()).isEqualTo(1);
    }

    private String seedAnnouncement(String label) {
        String id = tag + "-" + label;
        jdbc.update(
                "INSERT INTO engagement.\"Announcement\""
                        + " (\"id\", \"title\", \"content\", \"priority\", \"targetRoles\", \"targetYears\","
                        + " \"isGlobal\", \"publishAt\", \"expiresAt\", \"publishedBy\", \"semesterId\","
                        + " \"semesterName\", \"sectionId\", \"sectionNumber\", \"courseCode\", \"courseName\","
                        + " \"lecturerId\", \"lecturerDisplayName\", \"createdAt\", \"updatedAt\", \"status\","
                        + " \"authorId\")"
                        + " VALUES (:id, :title, :content, 'NORMAL', ARRAY['ADMIN'], ARRAY[1], FALSE,"
                        + " NULL, NULL, 'admin-1', 'semester-1', 'Semester 1', 'section-1', '01',"
                        + " 'CS101', 'Web Programming', 'lecturer-1', 'Lecturer One', :at, :at,"
                        + " 'DRAFT', 'admin-1')",
                new MapSqlParameterSource()
                        .addValue("id", id)
                        .addValue("title", "Original title " + label)
                        .addValue("content", "Original content")
                        .addValue("at", OffsetDateTime.ofInstant(BASE_TIME, ZoneOffset.UTC)));
        return id;
    }

    private static UpdateAnnouncementCommand updateCommand(
            String id,
            PatchValue<String> title,
            PatchValue<String> semesterId,
            PatchValue<String> sectionId,
            PatchValue<String> lecturerId) {
        return new UpdateAnnouncementCommand(
                id,
                title,
                PatchValue.omitted(),
                PatchValue.omitted(),
                PatchValue.omitted(),
                PatchValue.omitted(),
                PatchValue.omitted(),
                PatchValue.omitted(),
                PatchValue.omitted(),
                semesterId,
                sectionId,
                lecturerId,
                Instant.now(),
                0);
    }
}
