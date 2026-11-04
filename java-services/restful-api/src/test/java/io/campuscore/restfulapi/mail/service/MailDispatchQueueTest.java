package io.campuscore.restfulapi.mail.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.Test;

class MailDispatchQueueTest {

    @Test
    void runsNoMoreBatchesThanConfiguredWorkers() throws Exception {
        MailDispatchQueue queue = new MailDispatchQueue(2, 8);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger active = new AtomicInteger();
        AtomicInteger peak = new AtomicInteger();
        try {
            for (int index = 0; index < 6; index++) {
                assertThat(queue.submit(() -> {
                    peak.accumulateAndGet(active.incrementAndGet(), Math::max);
                    try {
                        release.await(5, TimeUnit.SECONDS);
                    } catch (InterruptedException interrupted) {
                        Thread.currentThread().interrupt();
                    } finally {
                        active.decrementAndGet();
                    }
                })).isTrue();
            }
            await(() -> active.get() == 2);
            assertThat(peak.get()).isLessThanOrEqualTo(2);

            release.countDown();
            assertThat(queue.awaitIdle(Duration.ofSeconds(5))).isTrue();
            assertThat(peak.get()).isEqualTo(2);
        } finally {
            release.countDown();
            queue.close();
        }
    }

    @Test
    void fullQueueRejectsTheNextBatchInsteadOfBlockingOrGrowing() throws Exception {
        MailDispatchQueue queue = new MailDispatchQueue(1, 1);
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try {
            assertThat(queue.submit(() -> {
                started.countDown();
                try {
                    release.await(5, TimeUnit.SECONDS);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
            })).isTrue();
            assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();

            assertThat(queue.submit(() -> { })).isTrue();
            long startedAt = System.nanoTime();
            assertThat(queue.submit(() -> { })).isFalse();
            assertThat(Duration.ofNanos(System.nanoTime() - startedAt)).isLessThan(Duration.ofSeconds(1));

            release.countDown();
            assertThat(queue.awaitIdle(Duration.ofSeconds(5))).isTrue();
        } finally {
            release.countDown();
            queue.close();
        }
    }

    @Test
    void awaitIdleReportsThatAQueuedBatchIsStillRunning() throws Exception {
        MailDispatchQueue queue = new MailDispatchQueue(1, 1);
        CountDownLatch release = new CountDownLatch(1);
        try {
            assertThat(queue.submit(() -> {
                try {
                    release.await(5, TimeUnit.SECONDS);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
            })).isTrue();

            assertThat(queue.awaitIdle(Duration.ofMillis(150))).isFalse();
            release.countDown();
            assertThat(queue.awaitIdle(Duration.ofSeconds(5))).isTrue();
        } finally {
            release.countDown();
            queue.close();
        }
    }

    private static void await(BooleanSupplier condition) throws InterruptedException {
        long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
        while (!condition.getAsBoolean() && System.nanoTime() < deadline) {
            Thread.sleep(10);
        }
    }
}
