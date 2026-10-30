package io.campuscore.restfulapi.thesis.assistant;

import static org.junit.jupiter.api.Assertions.*;

import io.micrometer.core.instrument.MeterRegistry;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(properties = "spring.datasource.url=jdbc:h2:mem:assistant_metrics;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1")
@ActiveProfiles({"test", "persistence"})
class AssistantPersistenceMetricsTest {
    @Autowired ThesisAssistantTurnRepository turns;
    @Autowired NamedParameterJdbcTemplate jdbc;
    @Autowired MeterRegistry registry;
    @Autowired @Qualifier(AssistantDatabaseConfiguration.TRANSACTION_MANAGER) PlatformTransactionManager manager;

    private double quota() {
        return registry.get("campuscore.assistant.quota.consumed.daily").gauge().value();
    }

    private double recovered() {
        return registry.get("campuscore.assistant.turn.stale.recovered").counter().count();
    }

    @Test
    void quotaMirrorsOnlyCommittedGlobalStateIncludingRefundAndDayReset() {
        LocalDate today = AssistantTimezone.currentBucketDate();
        jdbc.update("DELETE FROM assistant.usage_bucket", Map.of());
        assertEquals(0, quota());
        String owner = "quota-metric-" + UUID.randomUUID();
        TransactionTemplate transaction = new TransactionTemplate(manager);
        transaction.executeWithoutResult(status -> {
            assertNotNull(turns.chargeStandaloneQuota(owner, 20, 200));
            assertEquals(0, quota(), "uncommitted changes must not reach the scrape");
            status.setRollbackOnly();
        });
        assertEquals(0, quota());
        assertEquals(today, turns.chargeStandaloneQuota(owner, 20, 200));
        assertEquals(1, quota());
        turns.refundStandaloneQuota(owner, today);
        assertEquals(0, quota());
        var reserved = turns.reserve(owner, UUID.randomUUID(), "b".repeat(64), null, "en", "fixture", 90);
        assertTrue(turns.markSnapshotReady(reserved.turnId(), owner, reserved.leaseGeneration(), "c".repeat(64)));
        assertTrue(turns.dispatch(reserved.turnId(), owner, reserved.leaseGeneration(), 20, 200).dispatched());
        assertEquals(1, quota(), "ledger dispatch shares the committed global bucket");
        jdbc.update("UPDATE assistant.usage_bucket SET request_count=190 WHERE scope='GLOBAL'", Map.of());
        assertEquals(190, quota(), "persisted state must be visible without process-local increments");
        jdbc.update("UPDATE assistant.usage_bucket SET bucket_date=:yesterday", Map.of("yesterday", today.minusDays(1)));
        assertEquals(0, quota(), "prior campus-day usage must not bleed into the current day");
    }

    @Test
    void staleRecoveryCountsOnlySuccessfulCommittedCasIncludingOpportunisticRecovery() {
        String owner = "recovery-metric-" + UUID.randomUUID();
        UUID request = UUID.randomUUID();
        var reservation = turns.reserve(owner, request, "a".repeat(64), null, "en", "fixture", 90);
        jdbc.update("UPDATE assistant.chat_turn_ledger SET lease_expires_at=:expired WHERE turn_id=:turn",
                Map.of("expired", java.sql.Timestamp.from(java.time.Instant.now().minusSeconds(120)), "turn", reservation.turnId()));
        double before = recovered();
        new TransactionTemplate(manager).executeWithoutResult(status -> {
            turns.recoverExpiredLeases();
            assertEquals(before, recovered());
            status.setRollbackOnly();
        });
        assertEquals(before, recovered());
        turns.reserve(owner, request, "a".repeat(64), null, "en", "retry", 90);
        assertEquals(before + 1, recovered());
        turns.recoverExpiredLeases();
        assertEquals(before + 1, recovered(), "a lost CAS or repeat sweep must not increment");
    }
}
