package io.campuscore.restfulapi.thesis.assistant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.campuscore.restfulapi.thesis.assistant.ThesisAssistantKnowledgeRepository.KnowledgeDocument;
import io.campuscore.restfulapi.thesis.assistant.ThesisAssistantKnowledgeRepository.SnapshotRow;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Parity pins for the in-memory corpus snapshot. The snapshot path must replay
 * the SQL {@code WHERE}/{@code ORDER BY} of
 * {@link ThesisAssistantKnowledgeRepository#search} exactly — same scope
 * partition, same locale preference, same substring recall predicate, same
 * whole-word-weighted ordering — or the fast path would silently see different
 * documents depending on which route a request took.
 */
class KnowledgeSnapshotParityTest {

    private static final Instant NOW = Instant.parse("2026-03-01T00:00:00Z");

    private static SnapshotRow row(String slug, String locale, String domain, String title,
            String content, int priority) {
        return new SnapshotRow(
                new KnowledgeDocument(UUID.randomUUID().toString(), slug, locale, title, content,
                        "source/" + slug, domain, null, null, null,
                        UUID.randomUUID(), 1, "v1", "hash",
                        UUID.randomUUID(), 0),
                priority, NOW);
    }

    @Test
    @DisplayName("snapshot search keeps scope, locale, recall and ordering identical to SQL")
    void snapshotParity() {
        SnapshotRow viAcademic = row("cert-vi", "vi", "PUBLIC", "Xin giấy xác nhận sinh viên",
                "Nội dung hướng dẫn xin giấy xác nhận", 5);
        SnapshotRow bothAcademic = row("cert-both", "both", "PUBLIC", "Student certificates",
                "Hướng dẫn giấy xác nhận cho mọi sinh viên", 1);
        SnapshotRow viSpecialized = row("devops-vi", "vi", "SPECIALIZED", "CI/CD pipeline",
                "giấy xác nhận in content but specialized domain", 9);
        SnapshotRow enAcademic = row("cert-en", "en", "PUBLIC", "Certificate guide en",
                "giấy xác nhận english content", 0);

        List<SnapshotRow> snapshot = List.of(viAcademic, bothAcademic, viSpecialized, enAcademic);

        List<KnowledgeDocument> academic = ThesisAssistantKnowledgeRepository.searchSnapshot(
                snapshot, "vi", List.of("giấy xác nhận"), 10, false);
        // Specialized-domain and en-only rows are excluded; vi outranks both.
        assertEquals(List.of("cert-vi", "cert-both"),
                academic.stream().map(KnowledgeDocument::slug).toList());
        // Whole-word title hits earn the boundary bonus; the row score must be
        // populated like the SQL lexical_score column.
        assertTrue(academic.get(0).lexicalScore() >= 4);

        List<KnowledgeDocument> specialized = ThesisAssistantKnowledgeRepository.searchSnapshot(
                snapshot, "vi", List.of("giấy xác nhận"), 10, true);
        assertEquals(List.of("devops-vi"),
                specialized.stream().map(KnowledgeDocument::slug).toList());

        // No term hit -> no candidate (mirrors the SQL WHERE recall gate).
        assertTrue(ThesisAssistantKnowledgeRepository.searchSnapshot(
                snapshot, "vi", List.of("kubernetes"), 10, false).isEmpty());
    }

    @Test
    @DisplayName("snapshot ordering breaks score ties by priority then recency")
    void snapshotTieBreak() {
        SnapshotRow olderLowPriority = row("a", "vi", "PUBLIC", "Điểm", "điểm x", 9);
        SnapshotRow newerHighPriority = new SnapshotRow(
                row("b", "vi", "PUBLIC", "Điểm", "điểm x", 0).document(), 0,
                NOW.plusSeconds(60));
        List<KnowledgeDocument> ordered = ThesisAssistantKnowledgeRepository.searchSnapshot(
                List.of(olderLowPriority, newerHighPriority), "vi", List.of("điểm"), 10, false);
        assertEquals(List.of("b", "a"), ordered.stream().map(KnowledgeDocument::slug).toList());
    }

    @Test
    @DisplayName("repository falls back to SQL when the snapshot query fails")
    void snapshotFailureFallsBackToSql() {
        org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate jdbc =
                org.mockito.Mockito.mock(org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate.class);
        org.mockito.Mockito.when(jdbc.query(org.mockito.ArgumentMatchers.anyString(),
                        org.mockito.ArgumentMatchers.<org.springframework.jdbc.core.RowMapper<Object>>any()))
                .thenThrow(new org.springframework.dao.DataAccessResourceFailureException("db down"));
        ThesisAssistantKnowledgeRepository repository = new ThesisAssistantKnowledgeRepository(
                jdbc, false, true, 30_000L);

        repository.search("vi", List.of("giấy"), 5);

        // The snapshot load threw, but the caller still reached the SQL search —
        // the 3-arg query overload carries the scored SELECT.
        org.mockito.Mockito.verify(jdbc).query(
                org.mockito.ArgumentMatchers.contains("knowledge_runtime_document"),
                org.mockito.ArgumentMatchers.any(org.springframework.jdbc.core.namedparam.MapSqlParameterSource.class),
                org.mockito.ArgumentMatchers.<org.springframework.jdbc.core.RowMapper<KnowledgeDocument>>any());
    }

    @Test
    @DisplayName("with a transaction runner the snapshot load isolates failure on the caller's connection")
    void snapshotLoadIsolatesFailureWithANestedSavepoint() {
        org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate jdbc =
                org.mockito.Mockito.mock(org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate.class);
        // Savepoint isolation: a failed statement inside the load must not
        // poison the caller's transaction — on Postgres it would abort with
        // 25P02 and defeat the in-request SQL fallback entirely. Suspending
        // for a second pooled connection instead would starve the bounded
        // assistant pool, so the propagation flag is the load-bearing pin.
        org.springframework.transaction.PlatformTransactionManager txManager =
                org.mockito.Mockito.mock(org.springframework.transaction.PlatformTransactionManager.class);
        org.mockito.Mockito.when(txManager.getTransaction(org.mockito.ArgumentMatchers.any()))
                .thenReturn(new org.springframework.transaction.support.SimpleTransactionStatus());
        AssistantRlsTransactionRunner transactions =
                new AssistantRlsTransactionRunner(txManager, jdbc, true);
        ThesisAssistantKnowledgeRepository repository = new ThesisAssistantKnowledgeRepository(
                jdbc, false, true, 30_000L, transactions);

        repository.search("vi", List.of("giấy"), 5);

        org.mockito.ArgumentCaptor<org.springframework.transaction.TransactionDefinition> definition =
                org.mockito.ArgumentCaptor.forClass(org.springframework.transaction.TransactionDefinition.class);
        org.mockito.Mockito.verify(txManager).getTransaction(definition.capture());
        assertEquals(org.springframework.transaction.TransactionDefinition.PROPAGATION_NESTED,
                definition.getValue().getPropagationBehavior(),
                "the snapshot load must isolate failure with a savepoint on the caller's own connection");
    }

    @Test
    @DisplayName("an expired snapshot is never served once the freshness bound passes")
    void expiredSnapshotIsNotServedPastTheFreshnessBound() {
        org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate jdbc =
                org.mockito.Mockito.mock(org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate.class);
        java.util.concurrent.atomic.AtomicLong nanos =
                new java.util.concurrent.atomic.AtomicLong(java.util.concurrent.TimeUnit.MINUTES.toNanos(5));
        SnapshotRow withdrawn = row("withdrawn-cert", "vi", "PUBLIC",
                "Xin giấy xác nhận sinh viên", "Nội dung xin giấy xác nhận", 1);
        org.mockito.Mockito.when(jdbc.query(org.mockito.ArgumentMatchers.anyString(),
                        org.mockito.ArgumentMatchers.<org.springframework.jdbc.core.RowMapper<Object>>any()))
                .thenReturn(List.of(withdrawn))
                .thenThrow(new org.springframework.dao.DataAccessResourceFailureException("refresh cannot reach the database"));
        // The scoped SQL answer is honest: the knowledge was withdrawn.
        org.mockito.Mockito.when(jdbc.query(org.mockito.ArgumentMatchers.anyString(),
                        org.mockito.ArgumentMatchers.any(org.springframework.jdbc.core.namedparam.MapSqlParameterSource.class),
                        org.mockito.ArgumentMatchers.<org.springframework.jdbc.core.RowMapper<KnowledgeDocument>>any()))
                .thenReturn(List.of());
        ThesisAssistantKnowledgeRepository repository = new ThesisAssistantKnowledgeRepository(
                jdbc, false, true, 30_000L, null, nanos::get);

        assertEquals(List.of("withdrawn-cert"), slugs(repository.search("vi", List.of("giấy"), 5)));
        // Inside the bound the resident snapshot remains authoritative — the
        // loader has still run exactly once.
        nanos.addAndGet(java.util.concurrent.TimeUnit.SECONDS.toNanos(29));
        assertEquals(List.of("withdrawn-cert"), slugs(repository.search("vi", List.of("giấy"), 5)));
        org.mockito.Mockito.verify(jdbc, org.mockito.Mockito.times(1)).query(
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.<org.springframework.jdbc.core.RowMapper<Object>>any());

        // Past the bound the refresh fails: the expired row must not be
        // served — the caller sees the scoped SQL answer instead.
        nanos.addAndGet(java.util.concurrent.TimeUnit.SECONDS.toNanos(2));
        assertTrue(repository.search("vi", List.of("giấy"), 5).isEmpty());
        // The failure backoff keeps follow-up calls on the SQL path without
        // another doomed load — and still never the expired snapshot.
        assertTrue(repository.search("vi", List.of("giấy"), 5).isEmpty());
        org.mockito.Mockito.verify(jdbc, org.mockito.Mockito.times(2)).query(
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.<org.springframework.jdbc.core.RowMapper<Object>>any());
        org.mockito.Mockito.verify(jdbc, org.mockito.Mockito.times(2)).query(
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.any(org.springframework.jdbc.core.namedparam.MapSqlParameterSource.class),
                org.mockito.ArgumentMatchers.<org.springframework.jdbc.core.RowMapper<KnowledgeDocument>>any());
    }

    @Test
    @DisplayName("a refresh after the bound serves the republished corpus")
    void snapshotRefreshAfterTheBoundServesTheRepublishedCorpus() {
        org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate jdbc =
                org.mockito.Mockito.mock(org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate.class);
        java.util.concurrent.atomic.AtomicLong nanos =
                new java.util.concurrent.atomic.AtomicLong(java.util.concurrent.TimeUnit.MINUTES.toNanos(5));
        SnapshotRow superseded = row("superseded-cert", "vi", "PUBLIC",
                "Xin giấy xác nhận sinh viên", "Nội dung xin giấy xác nhận", 1);
        SnapshotRow corrected = row("corrected-cert", "vi", "PUBLIC",
                "Xin giấy xác nhận sinh viên mới", "Nội dung giấy xác nhận đã sửa", 1);
        org.mockito.Mockito.when(jdbc.query(org.mockito.ArgumentMatchers.anyString(),
                        org.mockito.ArgumentMatchers.<org.springframework.jdbc.core.RowMapper<Object>>any()))
                .thenReturn(List.of(superseded))
                .thenReturn(List.of(corrected));
        ThesisAssistantKnowledgeRepository repository = new ThesisAssistantKnowledgeRepository(
                jdbc, false, true, 30_000L, null, nanos::get);

        assertEquals(List.of("superseded-cert"), slugs(repository.search("vi", List.of("giấy"), 5)));
        nanos.addAndGet(java.util.concurrent.TimeUnit.SECONDS.toNanos(29));
        assertEquals(List.of("superseded-cert"), slugs(repository.search("vi", List.of("giấy"), 5)));

        // Once the bound passes, the next search must reload — a republished
        // correction is visible no later than the configured bound.
        nanos.addAndGet(java.util.concurrent.TimeUnit.SECONDS.toNanos(2));
        assertEquals(List.of("corrected-cert"), slugs(repository.search("vi", List.of("giấy"), 5)));
        org.mockito.Mockito.verify(jdbc, org.mockito.Mockito.times(2)).query(
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.<org.springframework.jdbc.core.RowMapper<Object>>any());
    }

    private static List<String> slugs(List<KnowledgeDocument> documents) {
        return documents.stream().map(KnowledgeDocument::slug).toList();
    }

    @Test
    @DisplayName("a failed snapshot load backs off instead of re-probing every request")
    void snapshotFailureBackoffPreventsThunderingHerd() {
        org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate jdbc =
                org.mockito.Mockito.mock(org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate.class);
        org.mockito.Mockito.when(jdbc.query(org.mockito.ArgumentMatchers.anyString(),
                        org.mockito.ArgumentMatchers.<org.springframework.jdbc.core.RowMapper<Object>>any()))
                .thenThrow(new org.springframework.dao.DataAccessResourceFailureException("db down"));
        ThesisAssistantKnowledgeRepository repository = new ThesisAssistantKnowledgeRepository(
                jdbc, false, true, 30_000L);

        repository.search("vi", List.of("giấy"), 5);
        repository.search("vi", List.of("giấy"), 5);
        repository.search("vi", List.of("giấy"), 5);

        // The probe ran once; the 5s failure backoff swallowed the rest.
        org.mockito.Mockito.verify(jdbc, org.mockito.Mockito.times(1)).query(
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.<org.springframework.jdbc.core.RowMapper<Object>>any());
    }
}
