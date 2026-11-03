package io.campuscore.restfulapi.thesis.assistant;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import tools.jackson.databind.ObjectMapper;
import io.campuscore.restfulapi.thesis.ThesisAuthorityFixture;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
class ThesisAssistantGovernanceWebTest {

    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper mapper;
    @Autowired private NamedParameterJdbcTemplate jdbc;
    @Autowired private JdbcTemplate plainJdbc;
    private UUID createdDocument;

    @AfterEach
    void cleanup() {
        if (createdDocument != null) {
            jdbc.update("DELETE FROM assistant.knowledge_document WHERE id=:id",
                    new org.springframework.jdbc.core.namedparam.MapSqlParameterSource("id", createdDocument));
        }
    }

    @Test
    void adminCrudRequiresSecondReviewerAndArchivesPreviousPublication() throws Exception {
        String slug = "test-governance-" + UUID.randomUUID();
        String create = "{\"slug\":\"" + slug + "\",\"locale\":\"en\",\"title\":\"Draft title\",\"content\":\"Grounded draft content\",\"source\":\"test\",\"priority\":10}";
        String created = mvc.perform(post("/api/v1/admin/thesis/assistant/knowledge")
                        .with(admin("admin-a"))
                        .contentType("application/json").content(create))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("DRAFT"))
                .andReturn().getResponse().getContentAsString();
        createdDocument = UUID.fromString(mapper.readTree(created).get("documentId").asText());

        mvc.perform(put("/api/v1/admin/thesis/assistant/knowledge/{id}", createdDocument)
                        .with(admin("admin-a"))
                        .contentType("application/json")
                        .content("{\"slug\":\"" + slug + "-v2\",\"locale\":\"en\",\"title\":\"Updated title\",\"content\":\"Updated grounded content\",\"source\":\"test\",\"priority\":20}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("DRAFT"));

        mvc.perform(post("/api/v1/admin/thesis/assistant/knowledge/{id}/submit", createdDocument)
                        .with(admin("admin-a")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("PENDING_REVIEW"));

        mvc.perform(post("/api/v1/admin/thesis/assistant/knowledge/{id}/publish", createdDocument)
                        .with(admin("admin-a")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("KNOWLEDGE_SECOND_REVIEW_REQUIRED"));

        mvc.perform(post("/api/v1/admin/thesis/assistant/knowledge/{id}/publish", createdDocument)
                        .with(admin("admin-b")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("PUBLISHED"));

        mvc.perform(get("/api/v1/admin/thesis/assistant/knowledge/{id}", createdDocument)
                        .with(admin("admin-b")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value(slug + "-v2"))
                .andExpect(jsonPath("$.title").value("Updated title"))
                .andExpect(jsonPath("$.state").value("PUBLISHED"));

        Integer published = jdbc.queryForObject(
                "SELECT COUNT(*) FROM assistant.knowledge_document_revision WHERE document_id=:id AND state='PUBLISHED'",
                new org.springframework.jdbc.core.namedparam.MapSqlParameterSource("id", createdDocument), Integer.class);
        org.junit.jupiter.api.Assertions.assertEquals(1, published);

        mvc.perform(put("/api/v1/admin/thesis/assistant/knowledge/{id}", createdDocument)
                        .with(admin("admin-a"))
                        .contentType("application/json")
                        .content("{\"slug\":\"" + slug + "-v3\",\"locale\":\"en\",\"title\":\"Third title\",\"content\":\"Third grounded content\",\"source\":\"test\",\"priority\":30}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("DRAFT"));
        mvc.perform(post("/api/v1/admin/thesis/assistant/knowledge/{id}/submit", createdDocument)
                        .with(admin("admin-a")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("PENDING_REVIEW"));
        mvc.perform(post("/api/v1/admin/thesis/assistant/knowledge/{id}/publish", createdDocument)
                        .with(admin("admin-b")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("PUBLISHED"));

        Integer publishedAfterArchive = jdbc.queryForObject(
                "SELECT COUNT(*) FROM assistant.knowledge_document_revision WHERE document_id=:id AND state='PUBLISHED'",
                new org.springframework.jdbc.core.namedparam.MapSqlParameterSource("id", createdDocument), Integer.class);
        org.junit.jupiter.api.Assertions.assertEquals(1, publishedAfterArchive);
        Integer archived = jdbc.queryForObject(
                "SELECT COUNT(*) FROM assistant.knowledge_document_audit a JOIN assistant.knowledge_document_revision r ON r.id=a.revision_id WHERE r.document_id=:id AND a.action='ARCHIVE'",
                new org.springframework.jdbc.core.namedparam.MapSqlParameterSource("id", createdDocument), Integer.class);
        org.junit.jupiter.api.Assertions.assertEquals(1, archived);
    }

    @Test
    void knowledgeDraftUpdateDetectsStaleVersionsAndKeepsLegacyClientsWorking() throws Exception {
        String slug = "test-knowledge-version-" + UUID.randomUUID();
        String created = mvc.perform(post("/api/v1/admin/thesis/assistant/knowledge")
                        .with(admin("admin-a"))
                        .contentType("application/json")
                        .content("{\"slug\":\"" + slug + "\",\"locale\":\"en\",\"title\":\"Original title\",\"content\":\"Original grounded content\",\"source\":\"test\",\"priority\":10}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        var createdRevision = mapper.readTree(created);
        createdDocument = UUID.fromString(createdRevision.get("documentId").asText());
        String originalRevisionId = createdRevision.get("revisionId").asText();

        var firstSave = mvc.perform(put("/api/v1/admin/thesis/assistant/knowledge/{id}", createdDocument)
                        .with(admin("admin-a"))
                        .contentType("application/json")
                        .content("{\"slug\":\"" + slug + "-first\",\"locale\":\"en\",\"title\":\"First edit\",\"content\":\"First grounded content\",\"source\":\"test\",\"priority\":20,\"expectedVersion\":1}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        mvc.perform(put("/api/v1/admin/thesis/assistant/knowledge/{id}", createdDocument)
                        .with(admin("admin-a"))
                        .contentType("application/json")
                        .content("{\"slug\":\"" + slug + "-stale\",\"locale\":\"en\",\"title\":\"Stale edit\",\"content\":\"Stale grounded content\",\"source\":\"test\",\"priority\":30,\"expectedVersion\":1}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STALE_VERSION"));

        org.junit.jupiter.api.Assertions.assertEquals(2, mapper.readTree(firstSave).get("version").asInt());

        mvc.perform(put("/api/v1/admin/thesis/assistant/knowledge/{id}", createdDocument)
                        .with(admin("admin-a"))
                        .contentType("application/json")
                        .content("{\"slug\":\"" + slug + "-matched\",\"locale\":\"en\",\"title\":\"Matched edit\",\"content\":\"Matched grounded content\",\"source\":\"test\",\"priority\":40,\"expectedVersion\":2}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(3));

        mvc.perform(put("/api/v1/admin/thesis/assistant/knowledge/{id}", createdDocument)
                        .with(admin("admin-a"))
                        .contentType("application/json")
                        .content("{\"slug\":\"" + slug + "-legacy\",\"locale\":\"en\",\"title\":\"Legacy edit\",\"content\":\"Legacy grounded content\",\"source\":\"test\",\"priority\":50}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(4));

        String otherAdminSave = mvc.perform(put("/api/v1/admin/thesis/assistant/knowledge/{id}", createdDocument)
                        .with(admin("admin-b"))
                        .contentType("application/json")
                        .content("{\"slug\":\"" + slug + "-other-admin\",\"locale\":\"en\",\"title\":\"Other admin edit\",\"content\":\"Other admin grounded content\",\"source\":\"test\",\"priority\":60,\"expectedVersion\":4}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        var otherAdminRevision = mapper.readTree(otherAdminSave);

        org.junit.jupiter.api.Assertions.assertNotEquals(originalRevisionId, otherAdminRevision.get("revisionId").asText());
        var originalDraft = jdbc.queryForMap(
                "SELECT version,created_by,title,content FROM assistant.knowledge_document_revision WHERE id=:id",
                new org.springframework.jdbc.core.namedparam.MapSqlParameterSource("id", UUID.fromString(originalRevisionId)));
        org.junit.jupiter.api.Assertions.assertEquals(4, ((Number) originalDraft.get("version")).intValue());
        org.junit.jupiter.api.Assertions.assertEquals("admin-a", originalDraft.get("created_by"));
        org.junit.jupiter.api.Assertions.assertEquals("Legacy edit", originalDraft.get("title"));
        org.junit.jupiter.api.Assertions.assertEquals("Legacy grounded content", originalDraft.get("content"));
    }

    @Test
    void adminPriorityIsBoundedAndStudentsCannotReadKnowledgeAdminApi() throws Exception {
        mvc.perform(post("/api/v1/admin/thesis/assistant/knowledge")
                        .with(admin("admin-a"))
                        .contentType("application/json")
                        .content("{\"slug\":\"bad-priority\",\"locale\":\"en\",\"title\":\"x\",\"content\":\"y\",\"source\":\"test\",\"priority\":0}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));

        mvc.perform(get("/api/v1/admin/thesis/assistant/knowledge")
                        .with(student("governance-student-a")))
                .andExpect(status().isForbidden());
    }

    @Test
    void adminKnowledgeRejectsSensitiveContentBeforeItCanBePublished() throws Exception {
        mvc.perform(post("/api/v1/admin/thesis/assistant/knowledge")
                        .with(admin("admin-a"))
                        .contentType("application/json")
                        .content("{\"slug\":\"privacy-negative\",\"locale\":\"en\",\"title\":\"Public guidance\",\"content\":\"Contact student@example.edu for details\",\"source\":\"test\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("KNOWLEDGE_PRIVACY_REJECTED"));
    }

    @Test
    void streamIncludesDiscriminatedMetaDeltaCitationAndDoneEvents() throws Exception {
        // SSE completes on the stream executor, so the assertions must run on
        // the async-dispatched response, not on the initial empty one.
        var result = mvc.perform(post("/api/v1/thesis/assistant/chat/stream")
                        .with(student("governance-student-stream"))
                        .contentType("application/json")
                        .accept("text/event-stream")
                        .content("{\"message\":\"How do I choose a thesis topic?\",\"locale\":\"en\",\"clientRequestId\":\"00000000-0000-4000-8000-000000000010\"}"))
                .andExpect(status().isOk())
                .andReturn();
        result.getAsyncResult(30_000);
        mvc.perform(asyncDispatch(result))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("\"type\":\"meta\"")))
                .andExpect(content().string(containsString("\"type\":\"delta\"")))
                .andExpect(content().string(containsString("\"type\":\"citation\"")))
                .andExpect(content().string(containsString("\"type\":\"done\"")));
    }

    @Test
    void feedbackAdminSummaryAggregatesAcrossOwnersButStudentsAreForbidden() throws Exception {
        mvc.perform(get("/api/v1/admin/assistant/feedback")
                        .with(student("governance-student-feedback")))
                .andExpect(status().isForbidden());

        UUID conversation = UUID.randomUUID();
        UUID turn = UUID.randomUUID();
        UUID question = UUID.randomUUID();
        UUID answer = UUID.randomUUID();
        var params = new org.springframework.jdbc.core.namedparam.MapSqlParameterSource();
        jdbc.update("INSERT INTO assistant.chat_conversation(id,owner_id,locale,state,expires_at)"
                        + " VALUES (:id,:owner,'en','ACTIVE',CURRENT_TIMESTAMP+30)",
                new org.springframework.jdbc.core.namedparam.MapSqlParameterSource()
                        .addValue("id", conversation).addValue("owner", "feedback-owner-a"));
        try {
            jdbc.update("INSERT INTO assistant.chat_message(id,conversation_id,turn_id,role,content,model,degraded,reason_code)"
                            + " VALUES (:id,:conversation,:turn,'USER','seeded question','-',FALSE,'-')",
                    params.addValue("id", question).addValue("conversation", conversation).addValue("turn", turn));
            jdbc.update("INSERT INTO assistant.chat_message(id,conversation_id,turn_id,role,content,model,degraded,reason_code)"
                            + " VALUES (:id,:conversation,:turn,'ASSISTANT','seeded answer','m',FALSE,'ANSWERED')",
                    params.addValue("id", answer));
            jdbc.update("INSERT INTO assistant.chat_message_feedback(message_id,owner_id,rating,reason)"
                            + " VALUES (:message,:owner,'UP','HELPFUL')",
                    params.addValue("message", answer).addValue("owner", "feedback-owner-a"));
            jdbc.update("INSERT INTO assistant.chat_message_feedback(message_id,owner_id,rating,reason)"
                            + " VALUES (:message,:owner,'DOWN','INCORRECT')",
                    params.addValue("owner", "feedback-owner-b"));

            // Two distinct owners' rows land in one admin summary — the
            // ADMIN_GOVERNANCE policy set is what makes the cross-owner read
            // possible on a FORCE-RLS datasource. Filter by the seeded
            // message id because other tests may share the fixture database.
            mvc.perform(get("/api/v1/admin/assistant/feedback").with(admin("admin-a")))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.totals.total", org.hamcrest.Matchers.greaterThanOrEqualTo(2)))
                    .andExpect(jsonPath("$.recent[?(@.messageId=='" + answer + "')].rating",
                            org.hamcrest.Matchers.containsInAnyOrder("UP", "DOWN")))
                    .andExpect(jsonPath("$.recent[?(@.messageId=='" + answer + "')].questionPreview",
                            org.hamcrest.Matchers.everyItem(org.hamcrest.Matchers.is("seeded question"))));
        } finally {
            jdbc.update("DELETE FROM assistant.chat_conversation WHERE id=:id", params);
        }
    }

    private RequestPostProcessor admin(String subject) {
        return ThesisAuthorityFixture.role(plainJdbc, subject, "ADMIN");
    }

    private RequestPostProcessor student(String studentId) {
        return ThesisAuthorityFixture.student(plainJdbc, studentId);
    }
}
