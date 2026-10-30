package io.campuscore.restfulapi.security.ratelimit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class RateLimiterRetentionTest {

    private static final long START_MILLIS = 1_000_000_000L;

    @Test
    void retainsEachBucketUntilItsEffectiveWindowExpires() {
        TestClock clock = new TestClock(START_MILLIS);
        RateLimiterService limiter = new RateLimiterService(clock);
        String quarterHourKey = "ip:203.0.113.10:TWO_FACTOR_VERIFY";
        String hourKey = "user:account-1:MAIL_MUTATION";

        assertTrue(limiter.tryAcquire(quarterHourKey, 1, 900).allowed());
        assertTrue(limiter.tryAcquire(hourKey, 1, 3600).allowed());

        clock.advanceSeconds(301);
        limiter.cleanupExpiredBuckets();
        assertFalse(limiter.tryAcquire(quarterHourKey, 1, 900).allowed());
        assertFalse(limiter.tryAcquire(hourKey, 1, 3600).allowed());
        assertEquals(2, limiter.getActiveKeyCount());

        clock.advanceSeconds(598);
        limiter.cleanupExpiredBuckets();
        assertFalse(limiter.tryAcquire(quarterHourKey, 1, 900).allowed());
        assertFalse(limiter.tryAcquire(hourKey, 1, 3600).allowed());
        assertEquals(2, limiter.getActiveKeyCount());

        clock.advanceSeconds(1);
        limiter.cleanupExpiredBuckets();
        assertEquals(1, limiter.getActiveKeyCount());
        assertTrue(limiter.tryAcquire(quarterHourKey, 1, 900).allowed());
        assertFalse(limiter.tryAcquire(hourKey, 1, 3600).allowed());

        clock.advanceSeconds(2700);
        limiter.cleanupExpiredBuckets();
        assertEquals(0, limiter.getActiveKeyCount());
        assertTrue(limiter.tryAcquire(hourKey, 1, 3600).allowed());
    }

    @Test
    void cleanupCannotRemoveAnAttemptAcquiredWhileExpiryIsBeingChecked() throws Exception {
        TestClock clock = new TestClock(START_MILLIS);
        RateLimiterService limiter = new RateLimiterService(clock);
        String key = "ip:203.0.113.11:AUTH_LOGIN";
        assertTrue(limiter.tryAcquire(key, 1, 300).allowed());
        clock.advanceSeconds(301);

        CountDownLatch acquired = new CountDownLatch(1);
        CountDownLatch cleanupStarted = new CountDownLatch(1);
        CountDownLatch cleanupFinished = new CountDownLatch(1);
        AtomicReference<RateLimitResult> result = new AtomicReference<>();
        Thread acquisition = new Thread(() -> {
            result.set(limiter.tryAcquire(key, 1, 300));
            acquired.countDown();
        }, "rate-limit-expiry-acquisition");
        Thread cleanup = new Thread(() -> {
            cleanupStarted.countDown();
            limiter.cleanupExpiredBuckets();
            cleanupFinished.countDown();
        }, "rate-limit-expiry-cleanup");
        acquisition.setDaemon(true);
        cleanup.setDaemon(true);
        clock.pauseNextReadOn("rate-limit-expiry-acquisition");

        try {
            acquisition.start();
            assertTrue(clock.awaitPausedRead(5, TimeUnit.SECONDS),
                    "acquisition must pause inside its bucket computation");
            cleanup.start();
            assertTrue(cleanupStarted.await(5, TimeUnit.SECONDS), "cleanup must start");
            assertTrue(awaitBlocked(cleanup, 5, TimeUnit.SECONDS),
                    "cleanup must wait for the in-progress bucket computation");
        } finally {
            clock.resumePausedRead();
            if (acquisition.getState() != Thread.State.NEW) {
                acquisition.join(TimeUnit.SECONDS.toMillis(5));
            }
            if (cleanup.getState() != Thread.State.NEW) {
                cleanup.join(TimeUnit.SECONDS.toMillis(5));
            }
        }

        assertTrue(acquired.await(5, TimeUnit.SECONDS), "concurrent acquisition must finish");
        assertTrue(cleanupFinished.await(5, TimeUnit.SECONDS), "queued cleanup must finish");
        assertFalse(acquisition.isAlive(), "acquisition thread must terminate");
        assertFalse(cleanup.isAlive(), "cleanup thread must terminate");
        assertTrue(result.get().allowed());
        assertFalse(limiter.tryAcquire(key, 1, 300).allowed(),
                "cleanup must not detach a bucket after a fresh acquisition records its attempt");
    }

    private static boolean awaitBlocked(Thread thread, long timeout, TimeUnit unit) throws InterruptedException {
        long deadline = System.nanoTime() + unit.toNanos(timeout);
        while (System.nanoTime() < deadline) {
            if (thread.getState() == Thread.State.BLOCKED) {
                return true;
            }
            if (!thread.isAlive()) {
                return false;
            }
            Thread.sleep(1);
        }
        return thread.getState() == Thread.State.BLOCKED;
    }

    private static final class TestClock extends Clock {
        private final AtomicLong millis;
        private volatile String pausedThreadName;
        private volatile CountDownLatch pausedRead = new CountDownLatch(0);
        private volatile CountDownLatch resumeRead = new CountDownLatch(0);

        private TestClock(long initialMillis) {
            millis = new AtomicLong(initialMillis);
        }

        private void advanceSeconds(long seconds) {
            millis.addAndGet(seconds * 1000L);
        }

        private void pauseNextReadOn(String threadName) {
            pausedRead = new CountDownLatch(1);
            resumeRead = new CountDownLatch(1);
            pausedThreadName = threadName;
        }

        private boolean awaitPausedRead(long timeout, TimeUnit unit) throws InterruptedException {
            return pausedRead.await(timeout, unit);
        }

        private void resumePausedRead() {
            resumeRead.countDown();
        }

        @Override
        public ZoneId getZone() {
            return ZoneId.of("UTC");
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return Instant.ofEpochMilli(millis.get());
        }

        @Override
        public long millis() {
            if (Thread.currentThread().getName().equals(pausedThreadName)) {
                pausedThreadName = null;
                pausedRead.countDown();
                try {
                    if (!resumeRead.await(5, TimeUnit.SECONDS)) {
                        throw new IllegalStateException("test clock read was not resumed");
                    }
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("test clock read was interrupted", exception);
                }
            }
            return millis.get();
        }
    }
}
