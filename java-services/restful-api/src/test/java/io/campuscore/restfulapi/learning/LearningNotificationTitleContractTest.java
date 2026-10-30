package io.campuscore.restfulapi.learning;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.testsupport.CurrentAccountJwt;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** BH3-API-03: notification limits must not roll back valid learning transitions. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:learning_notification_title;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "app.notifications.push.enabled=false"
})
class LearningNotificationTitleContractTest {

    @Autowired private JdbcTemplate jdbc;
    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper objectMapper;

    private RequestPostProcessor lecturerJwt;
    private RequestPostProcessor studentJwt;

    @BeforeEach
    void fixture() throws Exception {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS campuscore_auth");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS notifications");
        jdbc.execute("DROP SCHEMA IF EXISTS learning CASCADE");
        jdbc.execute("DROP SCHEMA IF EXISTS academic CASCADE");
        jdbc.execute("DROP TABLE IF EXISTS notifications.notification");
        jdbc.execute("CREATE SCHEMA academic");
        // Keep the real V3 ceiling: widening this stub would hide the rollback.
        jdbc.execute("""
                CREATE TABLE notifications.notification (
                    id VARCHAR(120) PRIMARY KEY,
                    user_id VARCHAR(120) NOT NULL,
                    title VARCHAR(240) NOT NULL,
                    message VARCHAR(2000) NOT NULL,
                    type VARCHAR(60) NOT NULL,
                    link VARCHAR(500),
                    is_read BOOLEAN NOT NULL DEFAULT FALSE,
                    read_at TIMESTAMP WITH TIME ZONE,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
                )""");
        jdbc.execute("""
                CREATE TABLE academic."Section" (
                    "id" VARCHAR(120) PRIMARY KEY, "lecturerId" VARCHAR(120) NOT NULL)
                """);
        jdbc.execute("""
                CREATE TABLE academic."Student" (
                    "id" VARCHAR(120) PRIMARY KEY, "userId" VARCHAR(120) NOT NULL UNIQUE)
                """);
        jdbc.execute("""
                CREATE TABLE academic."Enrollment" (
                    "id" VARCHAR(120) PRIMARY KEY, "studentId" VARCHAR(120) NOT NULL,
                    "sectionId" VARCHAR(120) NOT NULL, "status" VARCHAR(40) NOT NULL)
                """);
        try (var connection = jdbc.getDataSource().getConnection()) {
            ScriptUtils.executeSqlScript(connection,
                    new ClassPathResource("db/migration-h2/V139__learning_schema.sql"));
        }
        CurrentAccountJwt.fixtureJwt(jdbc, "lecturer-1", "LECTURER");
        CurrentAccountJwt.fixtureJwt(jdbc, "student-1", "STUDENT");
        jdbc.update("DELETE FROM campuscore_auth.\"Lecturer\" WHERE \"id\" = 'lec-1'");
        jdbc.update("DELETE FROM campuscore_auth.\"Student\" WHERE \"id\" = 'stu-1'");
        jdbc.update("INSERT INTO campuscore_auth.\"Lecturer\" (\"id\", \"userId\")"
                + " VALUES ('lec-1', 'lecturer-1')");
        jdbc.update("INSERT INTO campuscore_auth.\"Student\" (\"id\", \"userId\", \"year\")"
                + " VALUES ('stu-1', 'student-1', 2)");
        jdbc.update("INSERT INTO academic.\"Section\" (\"id\", \"lecturerId\") VALUES ('sec-a', 'lec-1')");
        jdbc.update("INSERT INTO academic.\"Student\" (\"id\", \"userId\") VALUES ('stu-1', 'student-1')");
        jdbc.update("INSERT INTO academic.\"Enrollment\" (\"id\", \"studentId\", \"sectionId\", \"status\")"
                + " VALUES ('enr-1', 'stu-1', 'sec-a', 'ENROLLED')");
        lecturerJwt = CurrentAccountJwt.currentJwt(jdbc, "lecturer-1");
        studentJwt = CurrentAccountJwt.currentJwt(jdbc, "student-1");
    }

    @ParameterizedTest(name = "return: {0}")
    @MethodSource("returnTitles")
    void returnPersistsOneBoundedNoticeAndAudit(String variant, String title, String expectedTitle) throws Exception {
        JsonNode submitted = createPublishSubmit(title);
        String assignmentId = submitted.get("assignmentId").asText();
        String submissionId = submitted.get("id").asText();
        var auditBefore = audit(assignmentId);

        mvc.perform(post("/api/v1/learning/staff/submissions/" + submissionId + "/return")
                        .with(lecturerJwt).contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "comment", "Please revise", "score", 7.0,
                                "expectedVersion", submitted.get("version").asInt()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("RETURNED"))
                .andExpect(jsonPath("$.version").value(submitted.get("version").asInt() + 1))
                .andExpect(jsonPath("$.returnedAt").isNotEmpty());

        assertNoticeAndHistory(assignmentId, submissionId, title, expectedTitle,
                "INFO", "SUBMISSION_RETURNED", "RETURNED", 1, auditBefore);
    }

    @ParameterizedTest(name = "review: {0}")
    @MethodSource("reviewTitles")
    void reviewReturnedFixturePersistsOneBoundedNoticeAndAudit(
            String variant, String title, String expectedTitle) throws Exception {
        JsonNode submitted = createPublishSubmit(title);
        String assignmentId = submitted.get("assignmentId").asText();
        String submissionId = submitted.get("id").asText();
        // Seed RETURNED independently: the review regression must reach its
        // own notification insert even when the return helper is still broken.
        jdbc.update("UPDATE learning.\"Submission\" SET \"status\" = 'RETURNED',"
                + " \"returnedAt\" = CURRENT_TIMESTAMP, \"version\" = \"version\" + 1 WHERE \"id\" = ?",
                submissionId);
        jdbc.update("INSERT INTO learning.\"FeedbackRecord\""
                + " (\"id\", \"submissionId\", \"revisionId\", \"authorId\", \"comment\", \"score\")"
                + " VALUES ('fixture-feedback', ?, ?, 'lec-1', 'Please revise', 7)",
                submissionId, submitted.get("currentRevisionId").asText());
        jdbc.update("INSERT INTO learning.\"Audit\""
                + " (\"id\", \"assignmentId\", \"submissionId\", \"actorId\", \"action\")"
                + " VALUES ('fixture-return-audit', ?, ?, 'lec-1', 'SUBMISSION_RETURNED')",
                assignmentId, submissionId);
        var auditBefore = audit(assignmentId);
        var feedbackBefore = jdbc.queryForMap("SELECT * FROM learning.\"FeedbackRecord\""
                + " WHERE \"id\" = 'fixture-feedback'");

        mvc.perform(post("/api/v1/learning/staff/submissions/" + submissionId + "/review")
                        .with(lecturerJwt).contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "comment", "Final review", "score", 8.0,
                                "expectedVersion", submitted.get("version").asInt() + 1))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REVIEWED"))
                .andExpect(jsonPath("$.version").value(submitted.get("version").asInt() + 2))
                .andExpect(jsonPath("$.returnedAt").isNotEmpty())
                .andExpect(jsonPath("$.reviewedAt").isNotEmpty());

        assertNoticeAndHistory(assignmentId, submissionId, title, expectedTitle,
                "SUCCESS", "SUBMISSION_REVIEWED", "REVIEWED", 2, auditBefore);
        assertThat(jdbc.queryForMap("SELECT * FROM learning.\"FeedbackRecord\""
                + " WHERE \"id\" = 'fixture-feedback'")).isEqualTo(feedbackBefore);
    }

    private static Stream<Arguments> returnTitles() {
        return titleCases("Bài tập đã được trả về: ");
    }

    private static Stream<Arguments> reviewTitles() {
        return titleCases("Bài tập đã được chấm xong: ");
    }

    private static Stream<Arguments> titleCases(String prefix) {
        return Stream.of(
                Arguments.of("300 ASCII", "A".repeat(300), prefix + "A".repeat(239 - prefix.length()) + "…"),
                Arguments.of("300 Unicode", "Đ".repeat(300), prefix + "Đ".repeat(239 - prefix.length()) + "…"),
                Arguments.of("surrogate boundary", "Đ".repeat(238 - prefix.length()) + "🚀" + "x".repeat(60),
                        prefix + "Đ".repeat(238 - prefix.length()) + "…"),
                Arguments.of("combining boundary", "Đ".repeat(238 - prefix.length()) + "e\u0301" + "x".repeat(60),
                        prefix + "Đ".repeat(238 - prefix.length()) + "…"),
                Arguments.of("joined emoji boundary", "Đ".repeat(236 - prefix.length()) + "👩‍💻" + "x".repeat(60),
                        prefix + "Đ".repeat(236 - prefix.length()) + "…"),
                Arguments.of("short unchanged", "Bài tập 1", prefix + "Bài tập 1"),
                Arguments.of("240 unchanged", "A".repeat(240 - prefix.length()),
                        prefix + "A".repeat(240 - prefix.length())));
    }

    private JsonNode createPublishSubmit(String title) throws Exception {
        MvcResult created = mvc.perform(post("/api/v1/learning/staff/sections/sec-a/assignments")
                        .with(lecturerJwt).contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("title", title,
                                "deadlineAt", Instant.now().plus(2, ChronoUnit.DAYS).toString(), "maxScore", 10.0))))
                .andExpect(status().isCreated()).andReturn();
        String assignmentId = json(created).get("id").asText();
        mvc.perform(post("/api/v1/learning/staff/assignments/" + assignmentId + "/publish").with(lecturerJwt))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("PUBLISHED"));
        MvcResult draft = mvc.perform(post("/api/v1/learning/assignments/" + assignmentId + "/draft")
                        .with(studentJwt).header("Idempotency-Key", "title-draft"))
                .andExpect(status().isCreated()).andReturn();
        String submissionId = json(draft).get("id").asText();
        mvc.perform(put("/api/v1/learning/submissions/" + submissionId + "/draft")
                        .with(studentJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"textBody\":\"Completed assignment\"}"))
                .andExpect(status().isOk());
        MvcResult submitted = mvc.perform(post("/api/v1/learning/assignments/" + assignmentId + "/submit")
                        .with(studentJwt).header("Idempotency-Key", "title-submit"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("SUBMITTED")).andReturn();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM notifications.notification", Integer.class)).isZero();
        return json(submitted);
    }

    private void assertNoticeAndHistory(String assignmentId, String submissionId, String assignmentTitle,
            String expectedTitle, String type, String action, String submissionStatus, int feedbackCount,
            List<Map<String, Object>> auditBefore) {
        var notices = jdbc.queryForList("SELECT user_id, title, type, link FROM notifications.notification");
        assertThat(notices).hasSize(1);
        var notice = notices.getFirst();
        String actualTitle = (String) notice.get("title");
        assertThat(actualTitle).isEqualTo(expectedTitle);
        assertThat(actualTitle.length()).isLessThanOrEqualTo(240);
        assertThat(actualTitle.codePointCount(0, actualTitle.length())).isLessThanOrEqualTo(240);
        assertThat(notice.get("user_id")).isEqualTo("student-1");
        assertThat(notice.get("type")).isEqualTo(type);
        assertThat(notice.get("link")).isEqualTo("/dashboard/learn");
        assertThat(jdbc.queryForObject("SELECT \"title\" FROM learning.\"Assignment\" WHERE \"id\" = ?",
                String.class, assignmentId)).isEqualTo(assignmentTitle);
        assertThat(jdbc.queryForObject("SELECT \"status\" FROM learning.\"Submission\" WHERE \"id\" = ?",
                String.class, submissionId)).isEqualTo(submissionStatus);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM learning.\"FeedbackRecord\" WHERE \"submissionId\" = ?",
                Integer.class, submissionId)).isEqualTo(feedbackCount);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM learning.\"SubmissionRevision\" WHERE \"submissionId\" = ?",
                Integer.class, submissionId)).isEqualTo(1);
        assertThat(audit(assignmentId)).hasSize(auditBefore.size() + 1).containsAll(auditBefore);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM learning.\"Audit\""
                + " WHERE \"assignmentId\" = ? AND \"submissionId\" = ? AND \"actorId\" = 'lec-1' AND \"action\" = ?",
                Integer.class, assignmentId, submissionId, action)).isEqualTo(1);
    }

    private List<Map<String, Object>> audit(String assignmentId) {
        return jdbc.queryForList("SELECT * FROM learning.\"Audit\" WHERE \"assignmentId\" = ? ORDER BY \"id\"",
                assignmentId);
    }

    private JsonNode json(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8));
    }
}
