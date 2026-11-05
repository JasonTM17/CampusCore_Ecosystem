package io.campuscore.restfulapi.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MvcResult;

@EnabledIf("io.campuscore.restfulapi.web.MobileParityPostgresSupport#postgresTargetConfigured")
class AttachmentMultipartPostgresIT extends MobileParityPostgresSupport {
    private static final byte[] PDF = "%PDF-1.4 synthetic".getBytes(StandardCharsets.UTF_8);
    private static final byte[] OTHER_PDF = "%PDF-1.4 different".getBytes(StandardCharsets.UTF_8);

    private static MockMultipartFile file(String name, String type, byte[] bytes) {
        return new MockMultipartFile("file", name, type, bytes);
    }

    private static String hash(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private static byte[] oversized() {
        byte[] bytes = new byte[5 * 1024 * 1024 + 1];
        System.arraycopy(PDF, 0, bytes, 0, PDF.length);
        return bytes;
    }

    private String id(MvcResult response) throws Exception { return body(response).get("id").asText(); }

    @Test
    void admissionsMultipartPreservesOwnerChecksReplayValidationAndLegacyJson() throws Exception {
        String application = id(mvc.perform(post("/api/v1/admissions/applications").with(student)
                        .header("Idempotency-Key", "create-" + suffix).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"cycle\":\"pg-" + suffix + "\"}"))
                .andExpect(status().isCreated()).andReturn());
        assertApplicantUpload("admissions", application, 201, "/file");
    }

    @Test
    void careersMultipartPreservesOwnerChecksReplayValidationAndLegacyJson() throws Exception {
        String org = "pg-org-" + suffix;
        String opportunity = "pg-opp-" + suffix;
        jdbc.update("INSERT INTO careers.\"Organization\" (\"id\",\"name\") VALUES (?,?)", org, org);
        jdbc.update("INSERT INTO careers.\"Opportunity\" (\"id\",\"organizationId\",\"title\",\"status\",\"submittedBy\",\"publishedAt\") VALUES (?,?,?,'PUBLISHED',?,CURRENT_TIMESTAMP)", opportunity, org, "PG Job", lecturerUser);
        String application = id(mvc.perform(post("/api/v1/careers/applications").with(student)
                        .header("Idempotency-Key", "apply-" + suffix).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"opportunityId\":\"" + opportunity + "\",\"coverLetter\":\"synthetic\"}"))
                .andExpect(status().isOk()).andReturn());
        assertApplicantUpload("careers", application, 200, "/download");
    }

    private void assertApplicantUpload(String domain, String application, int success, String download) throws Exception {
        String url = "/api/v1/" + domain + "/applications/" + application + "/attachments";
        String replayKey = "upload-" + suffix;
        MvcResult uploaded = mvc.perform(multipart(url).file(file("cv.pdf", "application/pdf", PDF))
                        .param("checksum", hash(PDF)).with(student).header("Idempotency-Key", replayKey))
                .andExpect(status().is(success)).andExpect(jsonPath("$.attachments.length()").value(1))
                .andExpect(jsonPath("$.attachments[0].checksum").value(hash(PDF))).andReturn();
        String attachment = body(uploaded).at("/attachments/0/id").asText();
        MvcResult replay = mvc.perform(multipart(url).file(file("cv.pdf", "application/pdf", PDF))
                        .param("checksum", hash(PDF)).with(student).header("Idempotency-Key", replayKey))
                .andExpect(status().is(success)).andExpect(jsonPath("$.attachments.length()").value(1)).andReturn();
        assertThat(body(replay).at("/attachments/0/id").asText()).isEqualTo(attachment);
        mvc.perform(get(url + "/" + attachment + download).with(student)).andExpect(status().isOk()).andExpect(content().bytes(PDF));
        mvc.perform(multipart(url).file(file("cv.pdf", "application/pdf", OTHER_PDF)).with(student).header("Idempotency-Key", replayKey))
                .andExpect(status().isConflict());
        mvc.perform(multipart(url).file(file("bad.pdf", "application/pdf", PDF)).param("checksum", hash(OTHER_PDF))
                        .with(student).header("Idempotency-Key", "checksum-" + suffix))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("FILE_CHECKSUM_MISMATCH"));
        mvc.perform(multipart(url).file(file("bad.exe", "application/x-msdownload", PDF))
                        .with(student).header("Idempotency-Key", "type-" + suffix))
                .andExpect(status().isUnsupportedMediaType()).andExpect(jsonPath("$.code").value("ATTACHMENT_TYPE_UNSUPPORTED"));
        mvc.perform(multipart(url).file(file("large.pdf", "application/pdf", oversized()))
                        .with(student).header("Idempotency-Key", "size-" + suffix))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("ATTACHMENT_SIZE_INVALID"));
        mvc.perform(multipart(url).file(file("foreign.pdf", "application/pdf", PDF))
                        .with(otherStudent).header("Idempotency-Key", "foreign-" + suffix))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));
        mvc.perform(get(url + "/" + attachment + download).with(otherStudent)).andExpect(status().isNotFound());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + domain + ".\"Attachment\" WHERE \"applicationId\"=?", Integer.class, application)).isEqualTo(1);
        mvc.perform(post(url).with(student).header("Idempotency-Key", "json-text-" + suffix).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"note.txt\",\"contentType\":\"text/plain\",\"dataBase64\":\"" + Base64.getEncoder().encodeToString("hello".getBytes(StandardCharsets.UTF_8)) + "\"}"))
                .andExpect(status().isUnsupportedMediaType()).andExpect(jsonPath("$.code").value("ATTACHMENT_TYPE_UNSUPPORTED"));
        mvc.perform(post(url).with(student).header("Idempotency-Key", "json-pdf-" + suffix).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"note.pdf\",\"contentType\":\"application/pdf\",\"dataBase64\":\"" + Base64.getEncoder().encodeToString(PDF) + "\"}"))
                .andExpect(status().is(success)).andExpect(jsonPath("$.attachments.length()").value(2));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + domain + ".\"Attachment\" WHERE \"applicationId\"=?", Integer.class, application)).isEqualTo(2);
    }

    @Test
    void learningMultipartKeepsSectionSubmissionOwnershipAndJsonDraftCompatibility() throws Exception {
        String materials = "/api/v1/learning/staff/sections/" + section + "/materials";
        String material = id(mvc.perform(multipart(materials).file(file("slides.pdf", "application/pdf", PDF)).param("title", "PG slides")
                        .param("checksum", hash(PDF)).with(lecturer))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.checksum").value(hash(PDF))).andReturn());
        mvc.perform(get("/api/v1/learning/materials/" + material + "/file").with(student))
                .andExpect(status().isOk()).andExpect(content().bytes(PDF));
        mvc.perform(multipart(materials).file(file("slides.pdf", "application/pdf", PDF)).param("title", "PG foreign").with(otherLecturer))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("SECTION_NOT_ASSIGNED"));
        mvc.perform(multipart(materials).file(file("slides.pdf", "application/pdf", PDF)).param("title", "PG wrong hash")
                        .param("checksum", hash(OTHER_PDF)).with(lecturer))
                .andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("FILE_CHECKSUM_MISMATCH"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM learning.\"Material\" WHERE \"sectionId\"=?", Integer.class, section)).isEqualTo(1);
        String assignment = id(mvc.perform(post("/api/v1/learning/staff/sections/" + section + "/assignments").with(lecturer)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"PG report\",\"description\":\"synthetic\",\"deadlineAt\":\"" + Instant.now().plusSeconds(86400) + "\",\"maxScore\":10}"))
                .andExpect(status().isCreated()).andReturn());
        mvc.perform(post("/api/v1/learning/staff/assignments/" + assignment + "/publish").with(lecturer)).andExpect(status().isOk());
        String draftUrl = "/api/v1/learning/assignments/" + assignment + "/draft";
        String submission = id(mvc.perform(post(draftUrl).with(student).header("Idempotency-Key", "draft-" + suffix))
                .andExpect(status().isCreated()).andReturn());
        assertThat(id(mvc.perform(post(draftUrl).with(student).header("Idempotency-Key", "draft-" + suffix))
                .andExpect(status().isCreated()).andReturn())).isEqualTo(submission);
        String url = "/api/v1/learning/submissions/" + submission + "/draft";
        mvc.perform(multipart(HttpMethod.PUT, url).file(file("report.pdf", "application/pdf", PDF))
                        .param("textBody", "synthetic").param("checksum", hash(PDF)).with(student))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("DRAFT"));
        mvc.perform(multipart(HttpMethod.PUT, url).file(file("foreign.pdf", "application/pdf", PDF)).with(otherStudent))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("SUBMISSION_NOT_FOUND"));
        mvc.perform(multipart(HttpMethod.PUT, url).file(file("bad.exe", "application/x-msdownload", PDF)).with(student))
                .andExpect(status().isUnsupportedMediaType());
        mvc.perform(multipart(HttpMethod.PUT, url).file(file("large.pdf", "application/pdf", oversized())).with(student))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("ATTACHMENT_SIZE_INVALID"));
        mvc.perform(multipart(HttpMethod.PUT, url).file(file("hash.pdf", "application/pdf", PDF)).param("checksum", hash(OTHER_PDF)).with(student))
                .andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("FILE_CHECKSUM_MISMATCH"));
        assertThat(jdbc.queryForObject("SELECT \"draftFileName\" FROM learning.\"Submission\" WHERE \"id\"=?", String.class, submission)).isEqualTo("report.pdf");
        mvc.perform(put(url).with(student).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"textBody\":\"json\",\"fileName\":\"json.txt\",\"contentType\":\"text/plain\",\"contentBase64\":\"" + Base64.getEncoder().encodeToString("hello".getBytes(StandardCharsets.UTF_8)) + "\"}"))
                .andExpect(status().isOk());
        assertThat(jdbc.queryForObject("SELECT \"draftFileName\" FROM learning.\"Submission\" WHERE \"id\"=?", String.class, submission)).isEqualTo("json.txt");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM learning.\"Submission\" WHERE \"assignmentId\"=? AND \"studentId\"=?", Integer.class, assignment, studentProfile)).isEqualTo(1);
    }
}
