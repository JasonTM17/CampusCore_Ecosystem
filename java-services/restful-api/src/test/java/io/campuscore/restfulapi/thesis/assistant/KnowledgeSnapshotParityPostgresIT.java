package io.campuscore.restfulapi.thesis.assistant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import io.campuscore.restfulapi.thesis.assistant.AssistantRlsBoundary.Access;
import io.campuscore.restfulapi.thesis.assistant.ThesisAssistantKnowledgeRepository.KnowledgeDocument;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.mockito.ArgumentMatchers;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Real-PostgreSQL parity: the in-memory snapshot path and the per-request SQL
 * path must return identical documents for the identical corpus — same ids,
 * same lexical scores, same ordering, same locale preference and the same
 * scope partition. The assistant pool is pinned to one connection here, so a
 * refresh needing a second checkout would stall every search; and because
 * score comparison runs against real SQL, any drift between the SQL scoring
 * expression and the Java scorer fails this class. The caller must supply a
 * separate disposable database and runtime login.
 */
@EnabledIfEnvironmentVariable(named = "ASSISTANT_RLS_POSTGRES_URL", matches = "jdbc:postgresql:.+")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK, properties = {
        "spring.flyway.locations=classpath:db/migration",
        "spring.flyway.schemas=thesis,academic,campuscore_auth",
        "spring.flyway.default-schema=thesis",
        "spring.jpa.hibernate.ddl-auto=none",
        "assistant.rls.test-mode=false",
        "assistant.rag.service-mode=true",
        "assistant.rag.service-token=snapshot-it-internal-token-9fb407c5",
        "assistant.retention.enabled=false",
        "assistant.supabase.enabled=false",
        "deepseek.enabled=false",
        "spring.task.scheduling.enabled=false"
})
@ActiveProfiles("persistence")
class KnowledgeSnapshotParityPostgresIT {

    @Autowired AssistantRlsTransactionRunner transactions;
    @Autowired @Qualifier("namedParameterJdbcTemplate") NamedParameterJdbcTemplate primaryJdbc;
    @Autowired @Qualifier(AssistantDatabaseConfiguration.JDBC_TEMPLATE) NamedParameterJdbcTemplate assistantJdbc;

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> requiredEnv("ASSISTANT_RLS_POSTGRES_URL"));
        registry.add("spring.datasource.username", () -> valueOr("ASSISTANT_RLS_PRIMARY_USER", "postgres"));
        registry.add("spring.datasource.password", () -> valueOr("ASSISTANT_RLS_PRIMARY_PASSWORD", ""));
        registry.add("assistant.datasource.url", () -> requiredEnv("ASSISTANT_RLS_POSTGRES_URL"));
        registry.add("assistant.datasource.username", () -> "campuscore_assistant_runtime");
        registry.add("assistant.datasource.password", () -> requiredEnv("ASSISTANT_RLS_RUNTIME_PASSWORD"));
        registry.add("assistant.datasource.maximum-pool-size", () -> "1");
        registry.add("assistant.rls.test-mode", () -> "false");
        registry.add("security.jwt.secret", () -> requiredEnv("ASSISTANT_RLS_JWT_SECRET"));
        registry.add("security.jwt.refresh-secret", () -> requiredEnv("ASSISTANT_RLS_JWT_REFRESH_SECRET"));
    }

    @Test
    void sqlAndSnapshotPathsReturnIdenticalIdsScoresAndOrder() throws Throwable {
        UUID release = UUID.randomUUID();
        seedRelease(release);
        insertRuntimeDocument(release, "parity-vi", "POLICY", "vi",
                "Xin giấy xác nhận sinh viên", "Nội dung hướng dẫn xin giấy xác nhận", 5, true, 240);
        insertRuntimeDocument(release, "parity-both", "POLICY", "both",
                "Student certificates", "Hướng dẫn giấy xác nhận cho mọi sinh viên", 1, true, 180);
        insertRuntimeDocument(release, "parity-en", "POLICY", "en",
                "Certificate request guide", "giấy xác nhận english content", 0, true, 120);
        insertRuntimeDocument(release, "parity-spec", "SPECIALIZED", "vi",
                "CI/CD giấy xác nhận", "giấy xác nhận specialized content", 9, true, 60);
        insertRuntimeDocument(release, "parity-withdrawn", "POLICY", "vi",
                "giấy xác nhận withdrawn", "withdrawn giấy content", 0, false, 30);
        activate(release);

        NamedParameterJdbcTemplate sqlJdbc = spy(assistantJdbc);
        NamedParameterJdbcTemplate snapshotJdbc = spy(assistantJdbc);
        ThesisAssistantKnowledgeRepository sqlRepository = new ThesisAssistantKnowledgeRepository(
                sqlJdbc, false, false, 30_000L, transactions);
        AtomicLong clock = new AtomicLong(TimeUnit.MINUTES.toNanos(60));
        ThesisAssistantKnowledgeRepository snapshotRepository = new ThesisAssistantKnowledgeRepository(
                snapshotJdbc, false, true, 30_000L, transactions, clock::get);
        String owner = "snapshot-parity-" + UUID.randomUUID();

        for (String[] searchCase : new String[][] {
                {"vi", "giấy", null},
                {"en", "giấy", null},
                {"vi", "giấy", "specialized"},
                {"vi", "kubernetes", null},
        }) {
            String locale = searchCase[0];
            String scope = searchCase[2];
            List<KnowledgeDocument> viaSql = asUser(owner, "ROLE_STUDENT",
                    () -> sqlRepository.search(locale, List.of(searchCase[1]), 10, scope));
            List<KnowledgeDocument> viaSnapshot = asUser(owner, "ROLE_STUDENT",
                    () -> snapshotRepository.search(locale, List.of(searchCase[1]), 10, scope));
            assertEquals(projection(viaSql), projection(viaSnapshot),
                    "SQL/snapshot divergence for locale=" + locale + " scope=" + scope);
        }

        // Pin the concrete answer for the default scope: vi ranks first, the
        // 'both' row follows, SPECIALIZED/withdrawn/other-locale rows never
        // appear — the exact ORDER BY the SQL produces.
        List<KnowledgeDocument> unscoped = asUser(owner, "ROLE_STUDENT",
                () -> sqlRepository.search("vi", List.of("giấy"), 10, null));
        assertEquals(List.of("parity-vi", "parity-both"), slugs(unscoped));
        assertTrue(unscoped.get(0).lexicalScore() > unscoped.get(1).lexicalScore());
        List<KnowledgeDocument> specialized = asUser(owner, "ROLE_STUDENT",
                () -> sqlRepository.search("vi", List.of("giấy"), 10, "specialized"));
        assertEquals(List.of("parity-spec"), slugs(specialized));

        // Both routes were actually exercised: the snapshot loader ran once on
        // the caller's connection (pool size is 1) and the scored SQL ran for
        // every case on the SQL repository.
        verify(snapshotJdbc, times(1)).query(contains("knowledge_runtime_state"),
                ArgumentMatchers.<RowMapper<Object>>any());
        verify(sqlJdbc, atLeastOnce()).query(contains("lexical_score"),
                any(MapSqlParameterSource.class), ArgumentMatchers.<RowMapper<KnowledgeDocument>>any());
    }

    @Test
    void withdrawnKnowledgeIsNotServedBeyondTheFreshnessBound() throws Throwable {
        UUID release = UUID.randomUUID();
        seedRelease(release);
        insertRuntimeDocument(release, "bound-doc", "POLICY", "vi",
                "Xin giấy xác nhận sinh viên", "Nội dung xin giấy xác nhận", 1, true, 0);
        activate(release);

        NamedParameterJdbcTemplate snapshotJdbc = spy(assistantJdbc);
        AtomicLong clock = new AtomicLong(TimeUnit.MINUTES.toNanos(60));
        ThesisAssistantKnowledgeRepository repository = new ThesisAssistantKnowledgeRepository(
                snapshotJdbc, false, true, 30_000L, transactions, clock::get);
        String owner = "snapshot-bound-" + UUID.randomUUID();

        assertEquals(List.of("bound-doc"), slugs(asUser(owner, "ROLE_STUDENT",
                () -> repository.search("vi", List.of("giấy"), 5))));

        // A SQL-side withdrawal: the row leaves every future result set.
        primaryJdbc.update("UPDATE assistant.knowledge_runtime_document SET active=FALSE "
                + "WHERE release_id=:release AND source_id='bound-doc'", Map.of("release", release));
        // Inside the bound the resident copy may still answer — staleness is
        // bounded, not eliminated; the frozen clock keeps this deterministic.
        assertEquals(List.of("bound-doc"), slugs(asUser(owner, "ROLE_STUDENT",
                () -> repository.search("vi", List.of("giấy"), 5))));

        // Past the bound the withdrawn row must never be served — and the SQL
        // path agrees on the identical corpus.
        clock.addAndGet(TimeUnit.SECONDS.toNanos(31));
        assertTrue(asUser(owner, "ROLE_STUDENT",
                () -> repository.search("vi", List.of("giấy"), 5)).isEmpty());
        verify(snapshotJdbc, times(2)).query(contains("knowledge_runtime_state"),
                ArgumentMatchers.<RowMapper<Object>>any());
    }

    @Test
    void aFailedProbeInsideTheBoundaryCannotAbortTheCallerTransaction() throws Throwable {
        String owner = "snapshot-savepoint-" + UUID.randomUUID();
        Integer survived = asUser(owner, "ROLE_STUDENT", () -> {
            // A bad statement aborts the work unit on Postgres (25P02). The
            // savepoint must contain that abort so the caller's transaction
            // stays usable for the in-request SQL fallback.
            assertThrows(DataAccessException.class, () -> transactions.executeIsolatedUnchecked(
                    Access.AUTO, () -> assistantJdbc.queryForObject(
                            "SELECT missing_column FROM assistant.knowledge_runtime_document LIMIT 1",
                            Map.of(), Object.class)));
            return assistantJdbc.queryForObject("SELECT 1", Map.of(), Integer.class);
        });
        assertEquals(1, survived);
    }

    private void seedRelease(UUID release) {
        primaryJdbc.update("""
                INSERT INTO assistant.knowledge_release(id,corpus_version,corpus_hash,row_count,source,status,manifest,created_by,activated_at)
                VALUES (:id,'snapshot-it',:hash,0,'MANUAL','PUBLISHED','{}'::jsonb,'snapshot-it-seed',CURRENT_TIMESTAMP)
                """, Map.of("id", release, "hash", "0".repeat(32) + release.toString().replace("-", "")));
    }

    private void insertRuntimeDocument(UUID release, String slug, String domain, String locale,
            String title, String content, int priority, boolean active, int publishedMinutesAgo) {
        primaryJdbc.update("""
                INSERT INTO assistant.knowledge_runtime_document
                    (release_id,source_id,version,domain,slug,locale,title,content,source,priority,active,visibility,published_at)
                VALUES (:release,:sourceId,1,:domain,:slug,:locale,:title,:content,'snapshot-it',:priority,:active,'PUBLIC',
                    CURRENT_TIMESTAMP - make_interval(mins => :publishedAgo))
                """, Map.of("release", release, "sourceId", slug, "domain", domain, "slug", slug,
                "locale", locale, "title", title, "content", content, "priority", priority,
                "active", active, "publishedAgo", publishedMinutesAgo));
    }

    private void activate(UUID release) {
        primaryJdbc.update("INSERT INTO assistant.knowledge_runtime_state(singleton,active_release_id) "
                + "VALUES (TRUE,:id) ON CONFLICT (singleton) DO UPDATE SET "
                + "active_release_id=EXCLUDED.active_release_id,updated_at=CURRENT_TIMESTAMP",
                Map.of("id", release));
    }

    private static List<String> slugs(List<KnowledgeDocument> documents) {
        return documents.stream().map(KnowledgeDocument::slug).toList();
    }

    private static List<String> projection(List<KnowledgeDocument> documents) {
        return documents.stream()
                .map(document -> document.id() + "|" + document.slug() + "|" + document.locale()
                        + "|" + document.lexicalScore() + "|" + document.corpusVersion()
                        + "|" + document.releaseId())
                .toList();
    }

    private <T> T asUser(String owner, String role, AssistantRlsTransactionRunner.Work<T> work) throws Throwable {
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        Jwt jwt = Jwt.withTokenValue("snapshot-it-token").header("alg", "none").subject(owner).build();
        context.setAuthentication(new JwtAuthenticationToken(jwt, List.of(new SimpleGrantedAuthority(role))));
        SecurityContextHolder.setContext(context);
        try {
            return transactions.execute(Access.AUTO, work);
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    private static String requiredEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException(name + " is required for PostgreSQL integration tests");
        return value;
    }

    private static String valueOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
