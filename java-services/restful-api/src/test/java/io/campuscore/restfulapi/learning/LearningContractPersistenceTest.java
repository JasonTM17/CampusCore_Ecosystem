package io.campuscore.restfulapi.learning;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.testsupport.CurrentAccountJwt;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
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

/**
 * H2 contract test for the P09 learning domain (contract §6). Proves the
 * assignment lifecycle (LMS-T01/T02), submission lifecycle (LMS-T03..T06),
 * scoped lecturer authority, active-enrollment submission authority,
 * revoked-enrollment denial, immutable revisions (LMS-X02), the server-clock
 * deadline (LMS-X01), idempotent replays, and owner-scoped file access on the
 * real controllers + service + H2 mirror DDL. The PostgreSQL IT proves the
 * same deadline/authority rules on the real engine (env-gated).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:learning_contract;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class LearningContractPersistenceTest {

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    private RequestPostProcessor lecturerJwt;
    private RequestPostProcessor otherLecturerJwt;
    private RequestPostProcessor adminJwt;
    private RequestPostProcessor studentJwt;
    private RequestPostProcessor student2Jwt;
    private RequestPostProcessor outsiderJwt;
    private RequestPostProcessor pendingJwt;

    @BeforeEach
    void fixture() throws Exception {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS campuscore_auth");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS notifications");
        jdbc.execute("DROP SCHEMA IF EXISTS learning CASCADE");
        jdbc.execute("DROP SCHEMA IF EXISTS academic CASCADE");
        jdbc.execute("DROP TABLE IF EXISTS notifications.notification");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS learning");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS academic");
        // Return/review feedback notifies the student in the same transaction
        // (§11) — the inbox stub mirrors the events fixture.
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS notifications.notification (
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
        // Minimal academic authority tables — the LMS never writes them;
        // they exist so the roster/authority read-through runs on real SQL.
        jdbc.execute("""
                CREATE TABLE academic."Course" (
                    "id" VARCHAR(120) PRIMARY KEY, "code" VARCHAR(60) NOT NULL, "name" VARCHAR(240) NOT NULL)""");
        jdbc.execute("""
                CREATE TABLE academic."Section" (
                    "id" VARCHAR(120) PRIMARY KEY, "sectionNumber" VARCHAR(80) NOT NULL,
                    "courseId" VARCHAR(120) NOT NULL, "semesterId" VARCHAR(120) NOT NULL,
                    "lecturerId" VARCHAR(120), "capacity" INTEGER NOT NULL, "status" VARCHAR(40) NOT NULL)""");
        jdbc.execute("""
                CREATE TABLE academic."Student" (
                    "id" VARCHAR(120) PRIMARY KEY, "userId" VARCHAR(120) NOT NULL UNIQUE,
                    "studentId" VARCHAR(120) NOT NULL, "status" VARCHAR(40) NOT NULL DEFAULT 'ACTIVE')""");
        jdbc.execute("""
                CREATE TABLE academic."Enrollment" (
                    "id" VARCHAR(120) PRIMARY KEY, "studentId" VARCHAR(120) NOT NULL,
                    "sectionId" VARCHAR(120) NOT NULL, "semesterId" VARCHAR(120) NOT NULL,
                    "status" VARCHAR(40) NOT NULL, "enrolledAt" TIMESTAMP WITH TIME ZONE)""");
        try (java.sql.Connection connection = jdbc.getDataSource().getConnection()) {
            ScriptUtils.executeSqlScript(connection,
                    new ClassPathResource("db/migration-h2/V139__learning_schema.sql"));
        }

        lecturerJwt = CurrentAccountJwt.fixtureJwt(jdbc, "lecturer-1", "LECTURER");
        otherLecturerJwt = CurrentAccountJwt.fixtureJwt(jdbc, "lecturer-2", "LECTURER");
        adminJwt = CurrentAccountJwt.fixtureJwt(jdbc, "admin-user", "ADMIN");
        studentJwt = CurrentAccountJwt.fixtureJwt(jdbc, "student-1", "STUDENT");
        student2Jwt = CurrentAccountJwt.fixtureJwt(jdbc, "student-2", "STUDENT");
        outsiderJwt = CurrentAccountJwt.fixtureJwt(jdbc, "student-3", "STUDENT");

        // JWT claims resolve from the auth-side profile rows; academic rows
        // carry the same ids so section/enrollment joins see them.
        // campuscore_auth profile tables persist across the shared in-memory
        // database between tests — seed idempotently.
        jdbc.update("DELETE FROM campuscore_auth.\"Lecturer\" WHERE \"id\" IN ('lec-1','lec-2')");
        jdbc.update("DELETE FROM campuscore_auth.\"Student\" WHERE \"id\" IN ('stu-1','stu-2','stu-3','stu-4')");
        jdbc.update("INSERT INTO campuscore_auth.\"Lecturer\" (\"id\", \"userId\") VALUES (?, ?)",
                "lec-1", "lecturer-1");
        jdbc.update("INSERT INTO campuscore_auth.\"Lecturer\" (\"id\", \"userId\") VALUES (?, ?)",
                "lec-2", "lecturer-2");
        jdbc.update("INSERT INTO campuscore_auth.\"Student\" (\"id\", \"userId\", \"year\") VALUES (?, ?, 2)",
                "stu-1", "student-1");
        jdbc.update("INSERT INTO campuscore_auth.\"Student\" (\"id\", \"userId\", \"year\") VALUES (?, ?, 2)",
                "stu-2", "student-2");
        jdbc.update("INSERT INTO campuscore_auth.\"Student\" (\"id\", \"userId\", \"year\") VALUES (?, ?, 1)",
                "stu-3", "student-3");
        jdbc.update("INSERT INTO campuscore_auth.\"Student\" (\"id\", \"userId\", \"year\") VALUES (?, ?, 2)",
                "stu-4", "student-4");
        jdbc.update("INSERT INTO academic.\"Student\" (\"id\", \"userId\", \"studentId\") VALUES (?, ?, ?)",
                "stu-1", "student-1", "SV001");
        jdbc.update("INSERT INTO academic.\"Student\" (\"id\", \"userId\", \"studentId\") VALUES (?, ?, ?)",
                "stu-2", "student-2", "SV002");
        jdbc.update("INSERT INTO academic.\"Student\" (\"id\", \"userId\", \"studentId\") VALUES (?, ?, ?)",
                "stu-3", "student-3", "SV003");
        jdbc.update("INSERT INTO academic.\"Student\" (\"id\", \"userId\", \"studentId\") VALUES (?, ?, ?)",
                "stu-4", "student-4", "SV004");
        jdbc.update("INSERT INTO academic.\"Course\" (\"id\", \"code\", \"name\") VALUES ('c-oop', 'OOP101', 'Lap trinh OOP')");
        jdbc.update("INSERT INTO academic.\"Section\" (\"id\", \"sectionNumber\", \"courseId\","
                        + " \"semesterId\", \"lecturerId\", \"capacity\", \"status\")"
                        + " VALUES ('sec-a', '01', 'c-oop', 'sem-1', 'lec-1', 40, 'OPEN')");
        jdbc.update("INSERT INTO academic.\"Section\" (\"id\", \"sectionNumber\", \"courseId\","
                        + " \"semesterId\", \"lecturerId\", \"capacity\", \"status\")"
                        + " VALUES ('sec-b', '02', 'c-oop', 'sem-1', 'lec-2', 40, 'OPEN')");
        jdbc.update("INSERT INTO academic.\"Enrollment\" (\"id\", \"studentId\", \"sectionId\","
                        + " \"semesterId\", \"status\", \"enrolledAt\")"
                        + " VALUES ('enr-1', 'stu-1', 'sec-a', 'sem-1', 'ENROLLED', CURRENT_TIMESTAMP)");
        jdbc.update("INSERT INTO academic.\"Enrollment\" (\"id\", \"studentId\", \"sectionId\","
                        + " \"semesterId\", \"status\", \"enrolledAt\")"
                        + " VALUES ('enr-2', 'stu-2', 'sec-a', 'sem-1', 'CONFIRMED', CURRENT_TIMESTAMP)");
        // stu-1's old revoked seat in the other lecturer's section.
        jdbc.update("INSERT INTO academic.\"Enrollment\" (\"id\", \"studentId\", \"sectionId\","
                        + " \"semesterId\", \"status\", \"enrolledAt\")"
                        + " VALUES ('enr-3', 'stu-1', 'sec-b', 'sem-1', 'DROPPED', CURRENT_TIMESTAMP)");
        // stu-4's seat in sec-b is PENDING — roster-visible but not submittable.
        jdbc.update("INSERT INTO academic.\"Enrollment\" (\"id\", \"studentId\", \"sectionId\","
                        + " \"semesterId\", \"status\", \"enrolledAt\")"
                        + " VALUES ('enr-4', 'stu-4', 'sec-b', 'sem-1', 'PENDING', CURRENT_TIMESTAMP)");
        // Re-issue JWTs now that the profile rows exist so claims carry the ids.
        lecturerJwt = CurrentAccountJwt.fixtureJwt(jdbc, "lecturer-1", "LECTURER");
        otherLecturerJwt = CurrentAccountJwt.fixtureJwt(jdbc, "lecturer-2", "LECTURER");
        studentJwt = CurrentAccountJwt.fixtureJwt(jdbc, "student-1", "STUDENT");
        student2Jwt = CurrentAccountJwt.fixtureJwt(jdbc, "student-2", "STUDENT");
        outsiderJwt = CurrentAccountJwt.fixtureJwt(jdbc, "student-3", "STUDENT");
        pendingJwt = CurrentAccountJwt.fixtureJwt(jdbc, "student-4", "STUDENT");
    }

    // ---------------------------------------------------------------
    // helpers
    // ---------------------------------------------------------------

    private String createAssignmentJson(Instant deadline) {
        return "{\"title\":\"Bai tap 1\",\"description\":\"submit a report\","
                + "\"deadlineAt\":\"" + deadline + "\",\"maxScore\":10.0}";
    }

    private String createDraftAssignment(Instant deadline) throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/learning/staff/sections/sec-a/assignments")
                        .with(lecturerJwt).contentType(MediaType.APPLICATION_JSON)
                        .content(createAssignmentJson(deadline)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).get("id").asText();
    }

    private String publishedAssignmentId() throws Exception {
        String id = createDraftAssignment(Instant.now().plus(2, ChronoUnit.DAYS));
        mvc.perform(post("/api/v1/learning/staff/assignments/" + id + "/publish").with(lecturerJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PUBLISHED"));
        return id;
    }

    private String openDraft(String assignmentId, RequestPostProcessor student, String key) throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/learning/assignments/" + assignmentId + "/draft")
                        .with(student).header("Idempotency-Key", key))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).get("id").asText();
    }

    private String sha256(String text) throws Exception {
        return HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
    }

    private static String b64(String text) {
        return java.util.Base64.getEncoder().encodeToString(text.getBytes(StandardCharsets.UTF_8));
    }

    // ---------------------------------------------------------------
    // LMS-T01/T02 — assignment lifecycle + DRAFT scoping
    // ---------------------------------------------------------------

    @Test
    void assignmentLifecycleDraftPublishCloseArchive() throws Exception {
        String id = createDraftAssignment(Instant.now().plus(1, ChronoUnit.DAYS));

        // DRAFT is staff-scope: students see an indistinguishable 404/empty.
        mvc.perform(get("/api/v1/learning/assignments/" + id).with(studentJwt))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/learning/sections/sec-a/assignments").with(studentJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id=='" + id + "')]").isEmpty());

        // Draft edit requires the current version.
        mvc.perform(put("/api/v1/learning/staff/assignments/" + id).with(lecturerJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Bai tap 1 - v2\",\"version\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Bai tap 1 - v2"))
                .andExpect(jsonPath("$.version").value(2));
        mvc.perform(put("/api/v1/learning/staff/assignments/" + id).with(lecturerJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"stale\",\"version\":1}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STALE_VERSION"));

        mvc.perform(post("/api/v1/learning/staff/assignments/" + id + "/publish").with(lecturerJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PUBLISHED"));

        // Non-draft edits are rejected (LMS-T01: only DRAFT editable).
        mvc.perform(put("/api/v1/learning/staff/assignments/" + id).with(lecturerJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"late\",\"version\":1}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ASSIGNMENT_NOT_DRAFT"));

        mvc.perform(post("/api/v1/learning/staff/assignments/" + id + "/close").with(lecturerJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CLOSED"));
        mvc.perform(post("/api/v1/learning/staff/assignments/" + id + "/archive").with(lecturerJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ARCHIVED"));
    }

    // ---------------------------------------------------------------
    // Authority — section assignment, never role alone
    // ---------------------------------------------------------------

    @Test
    void otherSectionLecturerCannotMutateOrRead() throws Exception {
        String id = publishedAssignmentId();
        // ADMIN without a lecturer assignment is not staff in this domain.
        mvc.perform(get("/api/v1/learning/staff/sections/sec-a/assignments").with(adminJwt))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("LECTURER_SCOPE_REQUIRED"));
        // A lecturer assigned to another section gets SECTION_NOT_ASSIGNED.
        mvc.perform(get("/api/v1/learning/staff/sections/sec-a/assignments").with(otherLecturerJwt))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SECTION_NOT_ASSIGNED"));
        mvc.perform(post("/api/v1/learning/staff/assignments/" + id + "/close").with(otherLecturerJwt))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SECTION_NOT_ASSIGNED"));
        // Their own section works — authority is per-section, not global.
        mvc.perform(post("/api/v1/learning/staff/sections/sec-b/materials").with(otherLecturerJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"slide tuan 1\"}"))
                .andExpect(status().isCreated());
    }

    // ---------------------------------------------------------------
    // LMS-T03/T05 + LMS-X01/X02 — submission lifecycle
    // ---------------------------------------------------------------

    @Test
    void draftSubmitReturnResubmitReviewWithImmutableRevisions() throws Exception {
        String assignmentId = publishedAssignmentId();
        String submissionId = openDraft(assignmentId, studentJwt, "draft-1");

        // Draft content while DRAFT.
        mvc.perform(put("/api/v1/learning/submissions/" + submissionId + "/draft").with(studentJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"textBody\":\"nop som ban 1\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DRAFT"));

        // Submit creates revision 1 (immutable).
        mvc.perform(post("/api/v1/learning/assignments/" + assignmentId + "/submit")
                        .with(studentJwt).header("Idempotency-Key", "sub-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUBMITTED"));

        // Draft edits are closed after submit.
        mvc.perform(put("/api/v1/learning/submissions/" + submissionId + "/draft").with(studentJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"textBody\":\"sua trom\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SUBMISSION_NOT_DRAFT"));

        // Return needs feedback + the live version (SUBMITTED → RETURNED).
        // Draft insert(1) → saveDraft(2) → submit(3), so version 3 is current.
        mvc.perform(post("/api/v1/learning/staff/submissions/" + submissionId + "/return")
                        .with(lecturerJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"comment\":\"bo sung phan tich\",\"score\":7.0,\"expectedVersion\":3}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("RETURNED"));

        // Resubmit appends revision 2 — revision 1 survives untouched.
        mvc.perform(post("/api/v1/learning/assignments/" + assignmentId + "/resubmit")
                        .with(studentJwt).header("Idempotency-Key", "resub-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"textBody\":\"ban nop lai da bo sung\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("RESUBMITTED"));

        mvc.perform(get("/api/v1/learning/submissions/" + submissionId + "/revisions").with(studentJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].revisionNo").value(2))
                .andExpect(jsonPath("$[0].textBody").value("ban nop lai da bo sung"))
                .andExpect(jsonPath("$[1].revisionNo").value(1))
                .andExpect(jsonPath("$[1].textBody").value("nop som ban 1"));

        // Feedback history preserves the return comment (append-only).
        mvc.perform(get("/api/v1/learning/submissions/" + submissionId + "/feedback").with(studentJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].comment").value("bo sung phan tich"))
                .andExpect(jsonPath("$[0].score").value(7.0));

        // Review closes the cycle directly on RESUBMITTED work (LMS-T06) —
        // the lecturer does not need a second return to finish grading.
        mvc.perform(post("/api/v1/learning/staff/submissions/" + submissionId + "/review")
                        .with(lecturerJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"comment\":\"ok\",\"score\":8.0,\"expectedVersion\":5}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REVIEWED"));
        // REVIEWED is terminal for the review lane.
        mvc.perform(post("/api/v1/learning/staff/submissions/" + submissionId + "/review")
                        .with(lecturerJwt).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SUBMISSION_STATE_INVALID"));

        Integer revisions = jdbc.queryForObject(
                "SELECT COUNT(*) FROM learning.\"SubmissionRevision\" WHERE \"submissionId\" = ?",
                Integer.class, submissionId);
        Integer feedback = jdbc.queryForObject(
                "SELECT COUNT(*) FROM learning.\"FeedbackRecord\" WHERE \"submissionId\" = ?",
                Integer.class, submissionId);
        assertThat(revisions).isEqualTo(2);
        // One return comment + one review comment = two append-only feedback rows.
        assertThat(feedback).isEqualTo(2);
        // §11: return + review each notified the student in the same tx —
        // user_id is the auth user id resolved through academic."Student".
        Integer notices = jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications.notification WHERE user_id = 'student-1'",
                Integer.class);
        assertThat(notices).isEqualTo(2);
    }

    // ---------------------------------------------------------------
    // Enrollment authority — revoked enrollment cannot submit
    // ---------------------------------------------------------------

    @Test
    void revokedEnrollmentCannotOpenDraftOrSubmit() throws Exception {
        // stu-1's sec-b enrollment is DROPPED — the section exists and the
        // assignment is published by its own lecturer, but the seat is revoked.
        String id = createDraftAssignmentFor(otherLecturerJwt, "sec-b");
        mvc.perform(post("/api/v1/learning/staff/assignments/" + id + "/publish").with(otherLecturerJwt))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/learning/assignments/" + id + "/draft").with(studentJwt)
                        .header("Idempotency-Key", "revoked-draft"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_ENROLLED"));
        // An outsider without any enrollment sees the same wall.
        mvc.perform(post("/api/v1/learning/assignments/" + id + "/draft").with(outsiderJwt)
                        .header("Idempotency-Key", "outsider-draft"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_ENROLLED"));
        // A roster-visible PENDING seat still cannot post work — the
        // submittable gate is narrower than the read gate (exit criterion).
        mvc.perform(post("/api/v1/learning/assignments/" + id + "/draft").with(pendingJwt)
                        .header("Idempotency-Key", "pending-draft"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ENROLLMENT_NOT_ACTIVE"));
        // Even the read lane distinguishes dropped vs never-enrolled at submit.
        mvc.perform(get("/api/v1/learning/assignments/" + id).with(studentJwt))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_ENROLLED"));
    }

    @Test
    void midCourseRevocationBlocksNewWork() throws Exception {
        String assignmentId = publishedAssignmentId();
        String submissionId = openDraft(assignmentId, studentJwt, "draft-early");
        // Wukong F1: work actually submitted before the seat is revoked.
        mvc.perform(put("/api/v1/learning/submissions/" + submissionId + "/draft")
                        .with(studentJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"textBody\":\"draft before revocation\"}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/learning/assignments/" + assignmentId + "/submit")
                        .with(studentJwt).header("Idempotency-Key", "pre-drop-submit"))
                .andExpect(status().isOk());
        MvcResult revisionsResult = mvc.perform(
                        get("/api/v1/learning/submissions/" + submissionId + "/revisions")
                                .with(studentJwt))
                .andExpect(status().isOk())
                .andReturn();
        String revisionId = objectMapper.readTree(revisionsResult.getResponse()
                .getContentAsString()).get(0).get("id").asText();
        // Registrar revokes the seat after the submission exists.
        jdbc.update("UPDATE academic.\"Enrollment\" SET \"status\" = 'DROPPED'"
                + " WHERE \"id\" = 'enr-1'");
        mvc.perform(post("/api/v1/learning/assignments/" + assignmentId + "/resubmit")
                        .with(studentJwt).header("Idempotency-Key", "late-resubmit")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"textBody\":\"revoked seat write attempt\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ENROLLMENT_NOT_ACTIVE"));
        // Draft writes die with the seat (ownership alone is not authority).
        mvc.perform(put("/api/v1/learning/submissions/" + submissionId + "/draft")
                        .with(studentJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"textBody\":\"post-revocation edit\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ENROLLMENT_NOT_ACTIVE"));
        // Read lanes close too — submission, revisions, feedback, file bytes.
        mvc.perform(get("/api/v1/learning/submissions/" + submissionId).with(studentJwt))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_ENROLLED"));
        mvc.perform(get("/api/v1/learning/submissions/" + submissionId + "/revisions")
                        .with(studentJwt))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_ENROLLED"));
        mvc.perform(get("/api/v1/learning/submissions/" + submissionId + "/feedback")
                        .with(studentJwt))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_ENROLLED"));
        mvc.perform(get("/api/v1/learning/revisions/" + revisionId + "/file").with(studentJwt))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_ENROLLED"));
    }

    // ---------------------------------------------------------------
    // LMS-X01 — server-clock deadline
    // ---------------------------------------------------------------

    @Test
    void serverDeadlineRejectsLateSubmit() throws Exception {
        // Deadline already in the past at publish time — the server clock
        // decides, not the client's claim.
        String id = createDraftAssignment(Instant.now().minus(1, ChronoUnit.HOURS));
        mvc.perform(post("/api/v1/learning/staff/assignments/" + id + "/publish").with(lecturerJwt))
                .andExpect(status().isOk());
        openDraft(id, studentJwt, "draft-late");
        mvc.perform(post("/api/v1/learning/assignments/" + id + "/submit")
                        .with(studentJwt).header("Idempotency-Key", "late-key"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("DEADLINE_PASSED"));
        // The submission stays a draft — no partial revision leaked.
        Integer revisions = jdbc.queryForObject(
                "SELECT COUNT(*) FROM learning.\"SubmissionRevision\"", Integer.class);
        assertThat(revisions).isEqualTo(0);
    }

    @Test
    void closedAssignmentRejectsSubmitEvenBeforeDeadline() throws Exception {
        String id = publishedAssignmentId();
        openDraft(id, studentJwt, "draft-c");
        mvc.perform(post("/api/v1/learning/staff/assignments/" + id + "/close").with(lecturerJwt))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/learning/assignments/" + id + "/submit")
                        .with(studentJwt).header("Idempotency-Key", "closed-key"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ASSIGNMENT_NOT_OPEN"));
    }

    // ---------------------------------------------------------------
    // Idempotent replay (§1.3) — no second row, no second revision
    // ---------------------------------------------------------------

    @Test
    void submitReplayReturnsSameSubmissionWithoutSecondRevision() throws Exception {
        String assignmentId = publishedAssignmentId();
        String first = openDraft(assignmentId, studentJwt, "draft-r");
        String again = openDraft(assignmentId, studentJwt, "draft-r");
        assertThat(again).isEqualTo(first);

        mvc.perform(put("/api/v1/learning/submissions/" + first + "/draft").with(studentJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"textBody\":\"v1\"}"));
        mvc.perform(post("/api/v1/learning/assignments/" + assignmentId + "/submit")
                        .with(studentJwt).header("Idempotency-Key", "submit-r"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUBMITTED"));
        // Replay: same stored response, no second revision.
        mvc.perform(post("/api/v1/learning/assignments/" + assignmentId + "/submit")
                        .with(studentJwt).header("Idempotency-Key", "submit-r"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUBMITTED"));
        Integer revisions = jdbc.queryForObject(
                "SELECT COUNT(*) FROM learning.\"SubmissionRevision\" WHERE \"submissionId\" = ?",
                Integer.class, first);
        Integer submissions = jdbc.queryForObject(
                "SELECT COUNT(*) FROM learning.\"Submission\" WHERE \"assignmentId\" = ?",
                Integer.class, assignmentId);
        assertThat(revisions).isEqualTo(1);
        assertThat(submissions).isEqualTo(1);

        // Same key rebound to another request hash → IDEMPOTENCY_CONFLICT.
        mvc.perform(post("/api/v1/learning/assignments/" + assignmentId + "/draft")
                        .with(studentJwt).header("Idempotency-Key", "submit-r"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_CONFLICT"));
        // Missing key is a client error.
        mvc.perform(post("/api/v1/learning/assignments/" + assignmentId + "/draft")
                        .with(studentJwt))
                .andExpect(status().isBadRequest());
    }

    // ---------------------------------------------------------------
    // LMS-T07 — file authority + checksum
    // ---------------------------------------------------------------

    @Test
    void fileUploadChecksumVerifiedAndOwnerScopedDownload() throws Exception {
        String assignmentId = publishedAssignmentId();
        String submissionId = openDraft(assignmentId, studentJwt, "draft-f");

        // Wrong declared checksum → 422, nothing stored.
        mvc.perform(put("/api/v1/learning/submissions/" + submissionId + "/draft").with(studentJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"report.txt\",\"contentType\":\"text/plain\","
                                + "\"contentBase64\":\"" + b64("hello report") + "\","
                                + "\"checksum\":\"deadbeef\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("FILE_CHECKSUM_MISMATCH"));
        Integer files = jdbc.queryForObject(
                "SELECT COUNT(*) FROM learning.\"FileObject\"", Integer.class);
        assertThat(files).isEqualTo(0);

        // Correct checksum → stored and the revision carries the digest.
        mvc.perform(put("/api/v1/learning/submissions/" + submissionId + "/draft").with(studentJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"report.txt\",\"contentType\":\"text/plain\","
                                + "\"contentBase64\":\"" + b64("hello report") + "\","
                                + "\"checksum\":\"" + sha256("hello report") + "\"}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/learning/assignments/" + assignmentId + "/submit")
                        .with(studentJwt).header("Idempotency-Key", "submit-f"))
                .andExpect(status().isOk());

        String revisionId = objectMapper.readTree(mvc.perform(
                        get("/api/v1/learning/submissions/" + submissionId + "/revisions").with(studentJwt))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString())
                .get(0).get("id").asText();

        // Owner downloads bytes; the section's lecturer too; a classmate cannot.
        mvc.perform(get("/api/v1/learning/revisions/" + revisionId + "/file").with(studentJwt))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .content().bytes("hello report".getBytes(StandardCharsets.UTF_8)));
        mvc.perform(get("/api/v1/learning/staff/revisions/" + revisionId + "/file").with(lecturerJwt))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/learning/revisions/" + revisionId + "/file").with(student2Jwt))
                .andExpect(status().isNotFound());
        // Another section's lecturer is not staff for this submission.
        mvc.perform(get("/api/v1/learning/staff/revisions/" + revisionId + "/file").with(otherLecturerJwt))
                .andExpect(status().isForbidden());
    }

    // ---------------------------------------------------------------
    // Object-scope isolation (§1.1) — classmates' submissions are 404
    // ---------------------------------------------------------------

    @Test
    void studentCannotReadAnotherStudentsSubmission() throws Exception {
        String assignmentId = publishedAssignmentId();
        String submissionId = openDraft(assignmentId, studentJwt, "draft-a");
        openDraft(assignmentId, student2Jwt, "draft-b");
        mvc.perform(get("/api/v1/learning/submissions/" + submissionId).with(student2Jwt))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/learning/submissions/" + submissionId + "/revisions").with(student2Jwt))
                .andExpect(status().isNotFound());
        mvc.perform(put("/api/v1/learning/submissions/" + submissionId + "/draft").with(student2Jwt)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"textBody\":\"x\"}"))
                .andExpect(status().isNotFound());
        // Roster row exists for every active enrollee — staff view.
        mvc.perform(get("/api/v1/learning/staff/assignments/" + assignmentId + "/roster")
                        .with(lecturerJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));
    }

    // ---------------------------------------------------------------
    // Materials + learning roster read lane
    // ---------------------------------------------------------------

    @Test
    void materialCrudAndLearningRoster() throws Exception {
        MvcResult material = mvc.perform(post("/api/v1/learning/staff/sections/sec-a/materials")
                        .with(lecturerJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Slide tuan 1\",\"description\":\"intro\","
                                + "\"fileName\":\"slide.txt\",\"contentType\":\"text/plain\","
                                + "\"contentBase64\":\"" + b64("slide body") + "\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.checksum").value(sha256("slide body")))
                .andReturn();
        String materialId = objectMapper.readTree(material.getResponse().getContentAsString())
                .get("id").asText();

        mvc.perform(get("/api/v1/learning/sections/sec-a/materials").with(studentJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(materialId));
        // Enrolled student downloads the material file; non-enrolled does not.
        mvc.perform(get("/api/v1/learning/materials/" + materialId + "/file").with(studentJwt))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/learning/materials/" + materialId + "/file").with(outsiderJwt))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_ENROLLED"));

        // mySections — the native roster feed — reflects counts, excludes dropped.
        mvc.perform(get("/api/v1/learning/sections").with(studentJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].sectionId").value("sec-a"))
                .andExpect(jsonPath("$[0].materialCount").value(1));
        mvc.perform(get("/api/v1/learning/sections").with(outsiderJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));

        // Update with a stale version is a conflict; delete needs assignment.
        mvc.perform(put("/api/v1/learning/staff/materials/" + materialId).with(lecturerJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"stale\",\"version\":99}"))
                .andExpect(status().isConflict());
        mvc.perform(delete("/api/v1/learning/staff/materials/" + materialId).with(otherLecturerJwt))
                .andExpect(status().isForbidden());
        mvc.perform(delete("/api/v1/learning/staff/materials/" + materialId).with(lecturerJwt))
                .andExpect(status().isNoContent());
    }

    // ---------------------------------------------------------------
    // Boundary: LMS never writes the official academic record
    // ---------------------------------------------------------------

    @Test
    void learningCodeNeverTouchesEnrollmentOrGrades() throws Exception {
        // Source-scan proof: the learning services contain no write verbs
        // against academic."Enrollment"/"StudentGrade" — the roster is
        // read-only authority (contract §6 forbidden writes).
        String root = System.getProperty("user.dir");
        for (String file : new String[]{
                "src/main/java/io/campuscore/restfulapi/learning/service/LearningService.java",
                "src/main/java/io/campuscore/restfulapi/learning/service/LearningStudentService.java"}) {
            String source = java.nio.file.Files.readString(
                    java.nio.file.Path.of(root, file), StandardCharsets.UTF_8)
                    .replaceAll("/\\*.*?\\*/", "").replaceAll("//.*", "");
            for (String verb : new String[]{"INSERT INTO academic", "UPDATE academic",
                    "DELETE FROM academic", "MERGE INTO academic"}) {
                assertThat(source).as(file + " must not contain " + verb).doesNotContain(verb);
            }
        }

        // And functionally: a full lifecycle leaves the enrollment row untouched.
        String assignmentId = publishedAssignmentId();
        String submissionId = openDraft(assignmentId, studentJwt, "draft-g");
        mvc.perform(put("/api/v1/learning/submissions/" + submissionId + "/draft").with(studentJwt)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"textBody\":\"x\"}"));
        mvc.perform(post("/api/v1/learning/assignments/" + assignmentId + "/submit")
                        .with(studentJwt).header("Idempotency-Key", "sub-g"));
        String status = jdbc.queryForObject(
                "SELECT \"status\" FROM academic.\"Enrollment\" WHERE \"id\" = 'enr-1'",
                String.class);
        assertThat(status).isEqualTo("ENROLLED");
    }

    private String createDraftAssignmentFor(RequestPostProcessor lecturer, String sectionId)
            throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/learning/staff/sections/" + sectionId + "/assignments")
                        .with(lecturer).contentType(MediaType.APPLICATION_JSON)
                        .content(createAssignmentJson(Instant.now().plus(2, ChronoUnit.DAYS))))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).get("id").asText();
    }

    @SuppressWarnings("unused")
    private static JsonNode node(ObjectMapper mapper, MvcResult result) throws Exception {
        return mapper.readTree(result.getResponse().getContentAsString());
    }
}
