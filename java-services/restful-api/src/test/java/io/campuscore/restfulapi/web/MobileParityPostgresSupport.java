package io.campuscore.restfulapi.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.events.web.ListPaging;
import io.campuscore.restfulapi.testsupport.AccountAuthorityFixture;
import io.campuscore.restfulapi.testsupport.CurrentAccountJwt;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Real Flyway tables; per-test transaction rolls back only this fixture's writes. */
@SpringBootTest(properties = {"spring.flyway.locations=classpath:db/migration", "deepseek.enabled=false",
        "spring.jpa.hibernate.ddl-auto=none"})
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@Transactional
abstract class MobileParityPostgresSupport {
    @Autowired protected JdbcTemplate jdbc;
    @Autowired protected MockMvc mvc;
    @Autowired protected ObjectMapper mapper;
    protected String suffix;
    protected String studentUser;
    protected String otherUser;
    protected String studentProfile;
    protected String otherProfile;
    protected String lecturerUser;
    protected String otherLecturerUser;
    protected String lecturerProfile;
    protected String department;
    protected String section;
    protected RequestPostProcessor student;
    protected RequestPostProcessor otherStudent;
    protected RequestPostProcessor lecturer;
    protected RequestPostProcessor otherLecturer;
    protected static final String TOTAL = ListPaging.TOTAL_COUNT_HEADER;

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> env("CAMPUSCORE_E2E_POSTGRES_URL", "jdbc:postgresql://localhost:5432/campuscore_e2e"));
        registry.add("spring.datasource.username", () -> env("CAMPUSCORE_E2E_POSTGRES_USER", "postgres"));
        registry.add("spring.datasource.password", () -> env("CAMPUSCORE_E2E_POSTGRES_PASSWORD", "postgres"));
    }

    static boolean postgresTargetConfigured() {
        String value = System.getenv("CAMPUSCORE_E2E_POSTGRES_URL");
        return value != null && value.startsWith("jdbc:postgresql:");
    }

    private static String env(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    @BeforeEach
    void createOwnedFixture() {
        assertThat(jdbc.queryForObject("SELECT version()", String.class)).startsWith("PostgreSQL");
        suffix = UUID.randomUUID().toString().substring(0, 12);
        studentUser = "pg-student-" + suffix;
        otherUser = "pg-other-" + suffix;
        studentProfile = "pg-sp-" + suffix;
        otherProfile = "pg-op-" + suffix;
        lecturerUser = "pg-lecturer-" + suffix;
        otherLecturerUser = "pg-other-lec-" + suffix;
        lecturerProfile = "pg-lp-" + suffix;
        department = "pg-dept-" + suffix;
        section = "pg-sec-" + suffix;
        String year = "pg-year-" + suffix;
        String faculty = "pg-fac-" + suffix;
        String curriculum = "pg-cur-" + suffix;
        String course = "pg-course-" + suffix;
        String semester = "pg-sem-" + suffix;
        Timestamp start = Timestamp.from(Instant.parse("2020-01-01T00:00:00Z"));
        Timestamp end = Timestamp.from(Instant.parse("2099-01-01T00:00:00Z"));
        jdbc.update("INSERT INTO academic.\"AcademicYear\" (\"id\",\"year\",\"startDate\",\"endDate\") VALUES (?,2026,?,?)", year, start, end);
        jdbc.update("INSERT INTO academic.\"Faculty\" (\"id\",\"name\",\"code\") VALUES (?, ?, ?)", faculty, faculty, "F" + suffix);
        jdbc.update("INSERT INTO academic.\"Department\" (\"id\",\"name\",\"code\",\"facultyId\") VALUES (?,?,?,?)", department, department, "D" + suffix, faculty);
        jdbc.update("INSERT INTO academic.\"Curriculum\" (\"id\",\"name\",\"code\",\"departmentId\",\"academicYearId\",\"totalCredits\") VALUES (?,?,?,?,?,150)", curriculum, curriculum, "C" + suffix, department, year);
        jdbc.update("INSERT INTO academic.\"Course\" (\"id\",\"code\",\"name\",\"credits\",\"departmentId\") VALUES (?,?,?,3,?)", course, "PG" + suffix, course, department);
        jdbc.update("INSERT INTO academic.\"Semester\" (\"id\",\"name\",\"type\",\"academicYearId\",\"startDate\",\"endDate\",\"status\") VALUES (?,?,'FALL',?,?,?,'ACTIVE')", semester, semester, year, start, end);
        for (String user : List.of(studentUser, otherUser, lecturerUser, otherLecturerUser)) AccountAuthorityFixture.ensureUser(jdbc, user);
        for (String[] pair : List.of(new String[]{studentUser, studentProfile}, new String[]{otherUser, otherProfile})) {
            jdbc.update("INSERT INTO academic.\"Student\" (\"id\",\"userId\",\"studentId\",\"curriculumId\",\"year\",\"status\",\"admissionDate\") VALUES (?,?,?,?,2,'ACTIVE',?)", pair[1], pair[0], pair[1], curriculum, start);
            AccountAuthorityFixture.role(jdbc, pair[0], "STUDENT");
        }
        for (String[] pair : List.of(new String[]{lecturerUser, lecturerProfile}, new String[]{otherLecturerUser, "pg-olp-" + suffix})) {
            jdbc.update("INSERT INTO academic.\"Lecturer\" (\"id\",\"userId\",\"departmentId\",\"employeeId\") VALUES (?,?,?,?)", pair[1], pair[0], department, pair[1]);
            AccountAuthorityFixture.role(jdbc, pair[0], "LECTURER");
        }
        jdbc.update("INSERT INTO academic.\"Section\" (\"id\",\"sectionNumber\",\"courseId\",\"semesterId\",\"lecturerId\",\"capacity\",\"enrolledCount\",\"status\",\"version\") VALUES (?,'01',?,?,?,40,2,'OPEN',0)", section, course, semester, lecturerProfile);
        for (String profile : List.of(studentProfile, otherProfile)) {
            jdbc.update("INSERT INTO academic.\"Enrollment\" (\"id\",\"studentId\",\"sectionId\",\"semesterId\",\"courseId\",\"creditsSnapshot\",\"status\",\"gradeStatus\",\"enrolledAt\") VALUES (?,?,?,?,?,3,'ENROLLED','NOT_GRADED',CURRENT_TIMESTAMP)", UUID.randomUUID().toString(), profile, section, semester, course);
        }
        student = CurrentAccountJwt.currentJwt(jdbc, studentUser);
        otherStudent = CurrentAccountJwt.currentJwt(jdbc, otherUser);
        lecturer = CurrentAccountJwt.currentJwt(jdbc, lecturerUser);
        otherLecturer = CurrentAccountJwt.currentJwt(jdbc, otherLecturerUser);
    }

    protected JsonNode body(MvcResult result) throws Exception { return mapper.readTree(result.getResponse().getContentAsString()); }

    protected List<String> ids(List<JsonNode> rows, String field) {
        return rows.stream().map(row -> row.get(field).asText()).toList();
    }

    /** Paging must preserve every authorised row's JSON shape and the untouched unpaged body. */
    protected List<JsonNode> assertPaging(String url, RequestPostProcessor actor, String idField) throws Exception {
        MvcResult legacy = mvc.perform(get(url).with(actor)).andExpect(status().isOk()).andExpect(header().doesNotExist(TOTAL)).andReturn();
        JsonNode all = body(legacy);
        assertThat(all.isArray()).isTrue();
        String join = url.contains("?") ? "&" : "?";
        List<JsonNode> collected = new ArrayList<>();
        for (int page = 0; page <= (all.size() + 1) / 2; page++) {
            MvcResult response = mvc.perform(get(url + join + "page=" + page + "&limit=2").with(actor))
                    .andExpect(status().isOk()).andExpect(header().string(TOTAL, String.valueOf(all.size()))).andReturn();
            JsonNode slice = body(response);
            assertThat(slice.isArray()).isTrue();
            assertThat(slice.size()).isLessThanOrEqualTo(2);
            slice.forEach(collected::add);
        }
        List<JsonNode> originals = new ArrayList<>();
        all.forEach(originals::add);
        assertThat(collected).containsExactlyInAnyOrderElementsOf(originals);
        assertThat(ids(collected, idField)).doesNotHaveDuplicates();
        assertThat(mvc.perform(get(url).with(actor)).andReturn().getResponse().getContentAsByteArray())
                .isEqualTo(legacy.getResponse().getContentAsByteArray());
        mvc.perform(get(url + join + "limit=100").with(actor))
                .andExpect(status().isOk()).andExpect(header().string(TOTAL, String.valueOf(all.size())))
                .andExpect(jsonPath("$.length()").value(Math.min(all.size(), 100)));
        mvc.perform(get(url + join + "page=" + Integer.MAX_VALUE + "&limit=100").with(actor))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(0));
        return collected;
    }

    protected void assertInvalidPaging(String url) throws Exception {
        String join = url.contains("?") ? "&" : "?";
        for (String query : List.of("limit=0", "limit=101", "page=-1&limit=5", "page=0")) {
            mvc.perform(get(url + join + query).with(student)).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_PAGING"));
        }
        mvc.perform(get(url + join + "page=x&limit=2").with(student)).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }
}
