package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.academic.service.AcademicReadService;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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

    private static final String HISTORY_COURSE_CODES = "('SE401', 'SE402', 'SE403', 'SE404', 'SE405', 'SE406',"
            + " 'SE407', 'SE408', 'SE409', 'SE410', 'SE411', 'SE412')";

    private static final Map<String, Integer> DECLARED_PROGRAM_TOTALS = Map.ofEntries(
            Map.entry("curriculum-ais", 148),
            Map.entry("curriculum-auto", 150),
            Map.entry("curriculum-autoeng", 150),
            Map.entry("curriculum-bimeng", 146),
            Map.entry("curriculum-bte", 138),
            Map.entry("curriculum-civil", 147),
            Map.entry("curriculum-etec", 150),
            Map.entry("curriculum-fin", 140),
            Map.entry("curriculum-isbd", 145),
            Map.entry("curriculum-lscm", 142),
            Map.entry("curriculum-manuf", 148),
            Map.entry("curriculum-mis", 145),
            Map.entry("curriculum-netsec", 152),
            Map.entry("curriculum-robot", 149),
            Map.entry("curriculum-se", 150));

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

        List<StudentHistoryCredits> history = jdbc.query(
                "SELECT curriculum.\"id\" AS curriculum_id, student.\"id\" AS student_id,"
                        + " COALESCE(SUM(enrollment.\"creditsSnapshot\"), 0)::integer AS earned_credits"
                        + " FROM academic.\"Curriculum\" curriculum"
                        + " JOIN academic.\"Student\" student ON student.\"curriculumId\" = curriculum.\"id\""
                        + " LEFT JOIN academic.\"Enrollment\" enrollment"
                        + " ON enrollment.\"studentId\" = student.\"id\""
                        + " AND enrollment.\"id\" LIKE 'enrollment-history-%'"
                        + " AND enrollment.\"semesterId\" = 'semester-history-demo'"
                        + " AND enrollment.\"status\" = 'COMPLETED'"
                        + " AND enrollment.\"gradeStatus\" IN ('PUBLISHED', 'APPEALED')"
                        + " AND COALESCE(enrollment.\"letterGrade\", '') <> 'F'"
                        + " AND enrollment.\"courseId\" IN (SELECT course.\"id\" FROM academic.\"Course\" course"
                        + " WHERE course.\"code\" IN " + HISTORY_COURSE_CODES + ")"
                        + " WHERE curriculum.\"id\" IN " + SEEDED_CURRICULA
                        + " GROUP BY curriculum.\"id\", student.\"id\""
                        + " ORDER BY curriculum.\"id\", student.\"id\"",
                (rs, rowNum) -> new StudentHistoryCredits(
                        rs.getString("curriculum_id"),
                        rs.getString("student_id"),
                        rs.getInt("earned_credits")));

        Map<String, List<StudentHistoryCredits>> historyByCurriculum = new LinkedHashMap<>();
        for (StudentHistoryCredits row : history) {
            historyByCurriculum.computeIfAbsent(row.curriculumId(), ignored -> new ArrayList<>()).add(row);
        }

        List<CurriculumAudit> audits = balances.stream()
                .map(balance -> audit(balance, historyByCurriculum.getOrDefault(balance.curriculumId(), List.of())))
                .toList();
        System.out.println("CURRICULUM_TOTAL_AUDIT=" + audits);
        assertThat(audits)
                .as("seeded curricula")
                .hasSize(16);
        assertThat(audits.stream()
                .filter(audit -> audit.expectedCredits() != null && audit.declaredCredits() != audit.expectedCredits())
                .toList())
                .as("declared program totals")
                .isEmpty();
        assertThat(audits.stream()
                .filter(audit -> audit.expectedCredits() != null && audit.declaredCredits() < audit.maxHistoryCredits())
                .toList())
                .as("declared program totals versus completed history credits")
                .isEmpty();
        CurriculumAudit demo = audits.stream()
                .filter(audit -> "curriculum-demo".equals(audit.curriculumId()))
                .findFirst()
                .orElseThrow();
        assertThat(demo.declaredCredits())
                .as("curriculum-demo declared credits versus mandatory linked course credits")
                .isEqualTo(demo.mandatoryCredits());
    }

    private static CurriculumAudit audit(CreditBalance balance, List<StudentHistoryCredits> history) {
        StudentHistoryCredits top = history.stream()
                .max(Comparator.comparingInt(StudentHistoryCredits::earnedCredits))
                .orElse(null);
        return new CurriculumAudit(
                balance.curriculumId(),
                balance.declaredCredits(),
                balance.mandatoryCredits(),
                history.size(),
                top == null ? null : top.studentId(),
                top == null ? 0 : top.earnedCredits(),
                DECLARED_PROGRAM_TOTALS.get(balance.curriculumId()));
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

    private record StudentHistoryCredits(String curriculumId, String studentId, int earnedCredits) {
    }

    private record CurriculumAudit(
            String curriculumId,
            int declaredCredits,
            int mandatoryCredits,
            int studentCount,
            String topStudentId,
            int maxHistoryCredits,
            Integer expectedCredits) {
    }
}
