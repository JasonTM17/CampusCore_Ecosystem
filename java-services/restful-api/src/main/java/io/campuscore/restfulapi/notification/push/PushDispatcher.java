package io.campuscore.restfulapi.notification.push;

import io.campuscore.restfulapi.exception.AppException;
import io.campuscore.restfulapi.notification.push.DeliveryOutboxRepository.Claim;
import io.campuscore.restfulapi.notification.push.DeliveryOutboxRepository.DeliverySnapshot;
import io.campuscore.restfulapi.notification.push.PushProvider.DeliveryReceipt;
import io.campuscore.restfulapi.notification.push.PushProvider.PushPayload;
import io.campuscore.restfulapi.notification.push.PushProvider.PushProviderException;
import java.net.SocketTimeoutException;
import java.net.http.HttpTimeoutException;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeoutException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

/** Claims, validates, sends, and acknowledges one bounded outbox batch. */
@Service
@Profile("persistence")
public class PushDispatcher {

    private final DeliveryOutboxRepository outbox;
    private final PushTokenCryptography cryptography;
    private final PushProvider provider;
    private final PushProperties properties;
    private final Clock clock;

    @Autowired
    public PushDispatcher(
            DeliveryOutboxRepository outbox,
            PushTokenCryptography cryptography,
            PushProvider provider,
            PushProperties properties) {
        this(outbox, cryptography, provider, properties, Clock.systemUTC());
    }

    PushDispatcher(
            DeliveryOutboxRepository outbox,
            PushTokenCryptography cryptography,
            PushProvider provider,
            PushProperties properties,
            Clock clock) {
        this.outbox = outbox;
        this.cryptography = cryptography;
        this.provider = provider;
        this.properties = properties;
        this.clock = clock;
    }

    /** Returns the number of rows confirmed SENT in this pass. */
    public int dispatchBatch() {
        if (!properties.isEnabled()) {
            return 0;
        }
        Instant now = clock.instant();
        int maxAttempts = Math.max(1, Math.min(5, properties.getMaxAttempts()));
        List<Claim> claims = outbox.claim(
                UUID.randomUUID().toString(),
                properties.getBatchSize(),
                now,
                properties.getLeaseSeconds(),
                maxAttempts);
        int sent = 0;
        for (Claim claim : claims) {
            if (!provider.isConfigured()) {
                outbox.block(claim, "PUSH_PROVIDER_NOT_CONFIGURED", clock.instant());
                continue;
            }
            var candidate = outbox.loadForSend(claim, clock.instant());
            if (candidate.isEmpty()) {
                continue;
            }
            DeliverySnapshot delivery = candidate.get();
            String token;
            try {
                token = cryptography.decrypt(delivery.tokenCiphertext());
            } catch (AppException notConfigured) {
                if ("PUSH_NOT_CONFIGURED".equals(notConfigured.getCode())) {
                    outbox.block(claim, "PUSH_NOT_CONFIGURED", clock.instant());
                } else {
                    outbox.fail(claim, "TOKEN_DECRYPTION_FAILED", false, clock.instant(), null);
                }
                continue;
            } catch (RuntimeException invalidCiphertext) {
                outbox.fail(claim, "TOKEN_DECRYPTION_FAILED", false, clock.instant(), null);
                continue;
            }

            try {
                DeliveryReceipt receipt = provider.send(delivery.provider(), token,
                        PushPayload.forNotification(delivery.notificationId()));
                if (receipt != null && receipt.accepted()) {
                    if (outbox.acknowledgeSent(claim, clock.instant())) {
                        sent++;
                    }
                } else {
                    outbox.fail(claim, "PROVIDER_UNCONFIRMED", false, clock.instant(), null);
                }
            } catch (TimeoutException | SocketTimeoutException | HttpTimeoutException timeout) {
                failRetryable(claim, "PROVIDER_TIMEOUT");
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                failRetryable(claim, "PROVIDER_INTERRUPTED");
            } catch (PushProviderException failure) {
                if (failure.retryable()) {
                    failRetryable(claim, failure.code());
                } else {
                    outbox.fail(claim, failure.code(), false, clock.instant(), null);
                }
            } catch (Exception failure) {
                outbox.fail(claim, "PROVIDER_ERROR", false, clock.instant(), null);
            }
        }
        return sent;
    }

    private void failRetryable(Claim claim, String code) {
        Instant now = clock.instant();
        long delay = retryDelayMillis(claim.attemptCount());
        Instant nextAttempt = now.plusMillis(delay).truncatedTo(ChronoUnit.MICROS);
        outbox.fail(claim, code, true, now, nextAttempt);
    }

    private long retryDelayMillis(int attempt) {
        long cap = Math.max(1, properties.getRetryCapMs());
        long initial = Math.max(1, properties.getRetryInitialMs());
        int exponent = Math.min(30, Math.max(0, attempt - 1));
        long base = initial > cap / (1L << exponent)
                ? cap
                : Math.min(cap, initial * (1L << exponent));
        double jitter = Math.max(0, Math.min(1, properties.getRetryJitterRatio()));
        double lower = base * (1.0 - jitter);
        double upper = Math.min(cap, base * (1.0 + jitter));
        double delay = lower + ThreadLocalRandom.current().nextDouble() * Math.max(0, upper - lower);
        return Math.max(1, Math.min(cap, (long) delay));
    }
}
