package io.campuscore.restfulapi.academic.registration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import io.campuscore.restfulapi.academic.service.AcademicEnrollmentReadService;
import java.lang.reflect.Method;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * Table regression for DSJ-06: the prerequisite floor must understand the
 * same letter scale the transcript/legacy records use (including minus
 * bands), and an unknown non-null floor must fail closed.
 */
class RegistrationPrerequisiteLetterFloorTest {

    /** Strictly increasing scale: F is the lowest, A+ the highest. */
    private static final List<String> SCALE = List.of(
            "F", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+");

    private JdbcTemplate jdbc;
    private RegistrationService registration;
    private Method hasCompleted;

    @BeforeEach
    void setUp() throws Exception {
        String url = "jdbc:h2:mem:registration_letter_floor;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1";
        jdbc = new JdbcTemplate(new DriverManagerDataSource(url, "sa", ""));
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS \"academic\"");
        jdbc.execute("DROP TABLE IF EXISTS \"academic\".\"Enrollment\"");
        jdbc.execute("""
                CREATE TABLE "academic"."Enrollment" (
                    "id" VARCHAR(120) PRIMARY KEY,
                    "studentId" VARCHAR(120) NOT NULL,
                    "courseId" VARCHAR(120) NOT NULL,
                    "status" VARCHAR(40) NOT NULL DEFAULT 'ENROLLED',
                    "gradeStatus" VARCHAR(40) NOT NULL,
                    "letterGrade" VARCHAR(16)
                )
                """);
        for (String letter : SCALE) {
            insertEnrollment("enrollment-" + letter, student(letter), "course-" + letter, letter);
        }
        insertEnrollment("enrollment-W", student("W"), "course-W", "W");
        insertEnrollment("enrollment-multi-low-1", "student-multi-low", "course-multi-low", "C");
        insertEnrollment("enrollment-multi-low-2", "student-multi-low", "course-multi-low", "D");
        insertEnrollment("enrollment-multi-best-1", "student-multi-best", "course-multi-best", "C");
        insertEnrollment("enrollment-multi-best-2", "student-multi-best", "course-multi-best", "B-");

        registration = new RegistrationService(
                new NamedParameterJdbcTemplate(jdbc),
                mock(AcademicEnrollmentReadService.class),
                mock(RegistrationPdfRenderer.class),
                mock(CreditLimitApplicationService.class),
                mock(PlatformTransactionManager.class));
        // The decision seam is private today; reflection keeps the production
        // visibility unchanged while proving the real query + ranking path.
        hasCompleted = RegistrationService.class.getDeclaredMethod(
                "hasCompleted", String.class, String.class, String.class);
        hasCompleted.setAccessible(true);
    }

    @Test
    void everyEarnedLetterMeetsExactlyItsOwnFloorAndTheBandsAboveIt() throws Exception {
        for (String earned : SCALE) {
            for (String floor : SCALE) {
                boolean expected = !"F".equals(earned) && rank(earned) >= rank(floor);
                assertThat(hasCompleted(student(earned), "course-" + earned, floor))
                        .as("earned %s against floor %s", earned, floor)
                        .isEqualTo(expected);
            }
            assertThat(hasCompleted(student(earned), "course-" + earned, null))
                    .as("null floor means no floor for earned %s", earned)
                    .isEqualTo(!"F".equals(earned));
        }
    }

    @Test
    void unknownNonNullFloorFailsClosed() throws Exception {
        assertThat(hasCompleted(student("A+"), "course-A+", "Z")).isFalse();
        assertThat(hasCompleted(student("A+"), "course-A+", "B*")).isFalse();
        assertThat(hasCompleted(student("A+"), "course-A+", "")).isFalse();
    }

    @Test
    void failingAndWithdrawnLettersNeverSatisfyAnyFloor() throws Exception {
        for (String floor : SCALE) {
            assertThat(hasCompleted(student("F"), "course-F", floor))
                    .as("F against floor %s", floor).isFalse();
            assertThat(hasCompleted(student("W"), "course-W", floor))
                    .as("W against floor %s", floor).isFalse();
        }
        assertThat(hasCompleted(student("F"), "course-F", null)).isFalse();
        assertThat(hasCompleted(student("W"), "course-W", null)).isFalse();
    }

    @Test
    void bestAttemptDecidesTheFloor() throws Exception {
        assertThat(hasCompleted("student-multi-low", "course-multi-low", "B-")).isFalse();
        assertThat(hasCompleted("student-multi-low", "course-multi-low", "D")).isTrue();
        assertThat(hasCompleted("student-multi-best", "course-multi-best", "B-")).isTrue();
        assertThat(hasCompleted("student-multi-best", "course-multi-best", "A-")).isFalse();
    }

    private boolean hasCompleted(String studentId, String courseId, String floor) throws Exception {
        return (boolean) hasCompleted.invoke(registration, studentId, courseId, floor);
    }

    private static int rank(String letter) {
        return SCALE.indexOf(letter);
    }

    private static String student(String letter) {
        return "student-" + letter;
    }

    private void insertEnrollment(String id, String studentId, String courseId, String letter) {
        jdbc.update(
                "INSERT INTO \"academic\".\"Enrollment\" (\"id\", \"studentId\", \"courseId\", \"gradeStatus\", \"letterGrade\")"
                        + " VALUES (?, ?, ?, 'PUBLISHED', ?)",
                id, studentId, courseId, letter);
    }
}
