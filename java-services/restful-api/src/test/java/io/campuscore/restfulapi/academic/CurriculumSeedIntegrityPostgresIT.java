package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.academic.service.AcademicReadService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@EnabledIf("io.campuscore.restfulapi.academic.CurriculumSeedIntegrityPostgresIT#postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "spring.jpa.hibernate.ddl-auto=none"
})
@ActiveProfiles({"test", "persistence"})
class CurriculumSeedIntegrityPostgresIT {

    /**
     * The demo curricula only. Other integration tests share the database and create their
     * own curricula without course links, which must not be judged as seed data.
     */
    private static final String SEEDED_CURRICULA = "('curriculum-demo', 'curriculum-se', 'curriculum-ais',"
            + " 'curriculum-netsec', 'curriculum-isbd', 'curriculum-mis', 'curriculum-auto',"
            + " 'curriculum-etec', 'curriculum-robot', 'curriculum-manuf', 'curriculum-autoeng',"
            + " 'curriculum-bimeng', 'curriculum-civil', 'curriculum-bte', 'curriculum-fin',"
            + " 'curriculum-lscm')";

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private AcademicReadService academicRead;

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> valueOr(
                "CAMPUSCORE_E2E_POSTGRES_URL", "jdbc:postgresql://localhost:5432/campuscore_e2e"));
        registry.add("spring.datasource.username", () -> valueOr(
                "CAMPUSCORE_E2E_POSTGRES_USER", "postgres"));
        registry.add("spring.datasource.password", () -> valueOr(
                "CAMPUSCORE_E2E_POSTGRES_PASSWORD", "postgres"));
    }

    @Test
    void curriculaWithDepartmentCoursesHaveCurriculumCourseLinks() {
        List<EmptyCurriculum> emptyCurricula = jdbc.query(
                "SELECT curriculum.\"id\", curriculum.\"code\", curriculum.\"departmentId\","
                        + " (SELECT COUNT(*) FROM academic.\"Course\" course"
                        + " WHERE course.\"departmentId\" = curriculum.\"departmentId\") AS department_course_count,"
                        + " COALESCE((SELECT string_agg(student.\"studentId\", ', ' ORDER BY student.\"studentId\")"
                        + " FROM academic.\"Student\" student"
                        + " WHERE student.\"curriculumId\" = curriculum.\"id\"), '(none)') AS student_ids"
                        + " FROM academic.\"Curriculum\" curriculum"
                        + " WHERE curriculum.\"id\" IN " + SEEDED_CURRICULA
                        + " AND NOT EXISTS (SELECT 1 FROM academic.\"CurriculumCourse\" link"
                        + " WHERE link.\"curriculumId\" = curriculum.\"id\")"
                        + " ORDER BY curriculum.\"id\"",
                (rs, rowNum) -> new EmptyCurriculum(
                        rs.getString("id"),
                        rs.getString("code"),
                        rs.getString("departmentId"),
                        rs.getInt("department_course_count"),
                        rs.getString("student_ids")));
        List<String> deferredCurricula = emptyCurricula.stream()
                .filter(curriculum -> curriculum.departmentCourseCount() == 0)
                .map(EmptyCurriculum::toString)
                .toList();
        List<String> linkableCurricula = emptyCurricula.stream()
                .filter(curriculum -> curriculum.departmentCourseCount() > 0)
                .map(EmptyCurriculum::toString)
                .toList();

        System.out.println("CURRICULUM_ZERO_LINKS=" + emptyCurricula);
        System.out.println("CURRICULUM_DEFERRED_NO_DEPARTMENT_COURSES=" + deferredCurricula);
        assertThat(linkableCurricula)
                .as("curricula with existing courses in their department")
                .isEmpty();
    }

    @Test
    void curriculumTotalsMatchMandatoryCourseCredits() {
        List<CreditBalance> balances = jdbc.query(
                "SELECT curriculum.\"id\", curriculum.\"totalCredits\","
                        + " COALESCE(SUM(course.\"credits\") FILTER (WHERE link.\"isMandatory\"), 0)"
                        + " AS mandatory_credits"
                        + " FROM academic.\"Curriculum\" curriculum"
                        + " LEFT JOIN academic.\"CurriculumCourse\" link"
                        + " ON link.\"curriculumId\" = curriculum.\"id\""
                        + " LEFT JOIN academic.\"Course\" course ON course.\"id\" = link.\"courseId\""
                        + " WHERE curriculum.\"id\" IN " + SEEDED_CURRICULA
                        + " GROUP BY curriculum.\"id\", curriculum.\"totalCredits\""
                        + " ORDER BY curriculum.\"id\"",
                (rs, rowNum) -> new CreditBalance(
                        rs.getString("id"),
                        rs.getInt("totalCredits"),
                        rs.getInt("mandatory_credits")));

        System.out.println("CURRICULUM_CREDIT_BALANCES=" + balances);
        assertThat(balances.stream()
                .filter(balance -> balance.declaredCredits() != balance.mandatoryCredits())
                .toList())
                .as("declared curriculum credits versus mandatory linked course credits")
                .isEmpty();
    }

    @Test
    void studentOnSoftwareEngineeringCurriculumGetsAPlan() {
        List<String> studentIds = jdbc.queryForList(
                "SELECT \"id\" FROM academic.\"Student\""
                        + " WHERE \"curriculumId\" = 'curriculum-se' ORDER BY \"studentId\" LIMIT 1",
                String.class);
        assertThat(studentIds)
                .as("students assigned to curriculum-se")
                .isNotEmpty();

        var response = academicRead.findMyCurriculum(studentIds.get(0));
        assertThat(response.courses())
                .as("course plan for student %s", studentIds.get(0))
                .isNotEmpty();
    }

    static boolean postgresTargetConfigured() {
        String url = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return url != null && url.startsWith("jdbc:postgresql:");
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    private record EmptyCurriculum(
            String id,
            String code,
            String departmentId,
            int departmentCourseCount,
            String studentIds) {
    }

    private record CreditBalance(String curriculumId, int declaredCredits, int mandatoryCredits) {
    }
}
