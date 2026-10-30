package io.campuscore.restfulapi.notification.push;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.campuscore.restfulapi.notification.push.DeliveryOutboxRepository.Claim;
import io.campuscore.restfulapi.notification.push.DeliveryOutboxRepository.DeliverySnapshot;
import io.campuscore.restfulapi.notification.push.PushProvider.DeliveryReceipt;
import io.campuscore.restfulapi.notification.push.PushProvider.PushPayload;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.stubbing.Answer;

class PushBatchLeaseBudgetTest {

    @Test
    void slowSendsWithinTimeoutRetainAcknowledgementAuthorityAcrossTheWholeBatch() {
        Fixture fixture = new Fixture(25);
        try (var dispatcher = fixture.dispatcher()) {
            assertThat(dispatcher.dispatchBatch()).isEqualTo(25);
        }
        assertThat(fixture.providerCalls).isEqualTo(25);
        assertThat(fixture.acknowledged).hasSize(25);
        assertThat(fixture.claims).allSatisfy(claim -> assertThat(claim.attemptCount()).isEqualTo(1));
        assertThat(fixture.clock.instant()).isEqualTo(Instant.EPOCH.plusSeconds(25 * 19));
    }

    @Test
    void rowsWaitingBehindASendHaveNotConsumedAnAttemptOrLease() {
        Fixture fixture = new Fixture(26);
        try (var dispatcher = fixture.dispatcher()) {
            dispatcher.dispatchBatch();
        }
        assertThat(fixture.claimCountsAtSend).containsExactlyElementsOf(
                java.util.stream.IntStream.rangeClosed(1, 25).boxed().toList());
        assertThat(fixture.claims).hasSize(25);
        assertThat(fixture.claims).noneMatch(claim -> claim.id().equals("row-25"));
    }

    @Test
    void leaseExpiringDuringPreparationCannotReachTheProviderOrAcknowledge() {
        Fixture fixture = new Fixture(1);
        when(fixture.cryptography.decrypt("ciphertext")).thenAnswer(ignored -> {
            fixture.clock.advanceSeconds(61);
            return "synthetic-device-token";
        });
        try (var dispatcher = fixture.dispatcher()) {
            assertThat(dispatcher.dispatchBatch()).isZero();
        }
        assertThat(fixture.providerCalls).isZero();
        assertThat(fixture.acknowledged).isEmpty();
    }

    @Test
    void unconfiguredProviderRemainsBlockedWithoutSending() {
        Fixture fixture = new Fixture(25);
        fixture.provider = new UnconfiguredPushProvider();
        try (var dispatcher = fixture.dispatcher()) {
            assertThat(dispatcher.dispatchBatch()).isZero();
        }
        assertThat(fixture.blocked).hasSize(25);
        assertThat(fixture.acknowledged).isEmpty();
        assertThat(fixture.providerCalls).isZero();
    }

    @Test
    void disabledPushDoesNotClaimRows() {
        Fixture fixture = new Fixture(25);
        fixture.properties.setEnabled(false);
        try (var dispatcher = fixture.dispatcher()) {
            assertThat(dispatcher.dispatchBatch()).isZero();
        }
        assertThat(fixture.claims).isEmpty();
        assertThat(fixture.providerCalls).isZero();
    }

    // Simulate repository time fences; persistence tests exercise the actual SQL fences.
    private static final class Fixture {
        final MutableClock clock = new MutableClock();
        final PushProperties properties = new PushProperties();
        final DeliveryOutboxRepository outbox = mock(DeliveryOutboxRepository.class);
        final PushTokenCryptography cryptography = mock(PushTokenCryptography.class);
        final List<Claim> claims = new ArrayList<>();
        final List<Claim> acknowledged = new ArrayList<>();
        final List<Claim> blocked = new ArrayList<>();
        final List<Integer> claimCountsAtSend = new ArrayList<>();
        PushProvider provider;
        int providerCalls;

        Fixture(int rows) {
            properties.setEnabled(true);
            properties.setBatchSize(25);
            properties.setLeaseSeconds(60);
            properties.setSendTimeoutMs(20_000);
            Answer<List<Claim>> claimRows = call -> {
                int count = Math.min(call.<Integer>getArgument(1), rows - claims.size());
                List<Claim> batch = new ArrayList<>();
                for (int index = 0; index < count; index++) {
                    Claim claim = new Claim("row-" + claims.size(), "device", call.getArgument(0),
                            1, clock.instant().plusSeconds(call.getArgument(3)), 1);
                    claims.add(claim);
                    batch.add(claim);
                }
                return batch;
            };
            when(outbox.claim(anyString(), anyInt(), any(), anyLong(), anyInt())).thenAnswer(claimRows);
            when(outbox.claim(anyString(), anyInt(), any(), anyLong(), anyInt(), any())).thenAnswer(claimRows);
            when(outbox.loadForSend(any(), any())).thenAnswer(call -> {
                Claim claim = call.getArgument(0);
                return clock.instant().isBefore(claim.leaseUntil())
                        ? Optional.of(new DeliverySnapshot(claim.id(), "owner", "device", "owner",
                                "FCM", "ANDROID", "ACTIVE", "ciphertext", 0,
                                "notice-" + claim.id(), "owner", "owner", "ACTIVE", 0))
                        : Optional.empty();
            });
            when(outbox.acknowledgeSent(any(), any())).thenAnswer(call -> {
                Claim claim = call.getArgument(0);
                if (!clock.instant().isBefore(claim.leaseUntil())) {
                    return false;
                }
                acknowledged.add(claim);
                return true;
            });
            when(outbox.block(any(), anyString(), any())).thenAnswer(call -> {
                assertThat(call.<String>getArgument(1)).isEqualTo("PUSH_PROVIDER_NOT_CONFIGURED");
                blocked.add(call.getArgument(0));
                return true;
            });
            when(cryptography.decrypt("ciphertext")).thenReturn("synthetic-device-token");
            provider = new PushProvider() {
                @Override public boolean isConfigured() { return true; }

                @Override
                public DeliveryReceipt send(String providerName, String token, PushPayload payload,
                                            String deliveryKey) {
                    claimCountsAtSend.add(claims.size());
                    providerCalls++;
                    clock.advanceSeconds(19);
                    return new DeliveryReceipt(true);
                }
            };
        }

        PushDispatcher dispatcher() {
            return new PushDispatcher(outbox, cryptography, provider, properties, clock);
        }
    }

    private static final class MutableClock extends Clock {
        private volatile Instant now = Instant.EPOCH;

        void advanceSeconds(long seconds) { now = now.plusSeconds(seconds); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }
}
