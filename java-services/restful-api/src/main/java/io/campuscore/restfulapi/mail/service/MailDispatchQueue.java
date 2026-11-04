package io.campuscore.restfulapi.mail.service;

import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Service;

/**
 * Bounded hand-off for fire-and-forget mail batches. SMTP latency must never
 * hold a request thread or a database transaction, and a fan-out must not be
 * able to grow an unbounded pool, queue or pending payload. A caller that gets
 * {@code false} from {@link #submit(Runnable)} reports the affected recipients
 * itself; the queue never retries silently.
 */
@Service
public class MailDispatchQueue {

    private static final int WORKERS = 2;
    private static final int QUEUE_CAPACITY = 64;

    private final ThreadPoolExecutor workers;
    private final Object idleMonitor = new Object();
    private int pending;

    public MailDispatchQueue() {
        this(WORKERS, QUEUE_CAPACITY);
    }

    MailDispatchQueue(int workers, int queueCapacity) {
        this.workers = new ThreadPoolExecutor(
                workers, workers, 0L, TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(queueCapacity),
                Thread.ofPlatform().daemon(true).name("mail-dispatch-", 0).factory(),
                new ThreadPoolExecutor.AbortPolicy());
    }

    /**
     * Queues one batch without blocking. Returns false when the bounded queue
     * is full or the executor is shutting down.
     */
    public boolean submit(Runnable batch) {
        synchronized (idleMonitor) {
            pending++;
        }
        try {
            workers.execute(() -> {
                try {
                    batch.run();
                } finally {
                    finished();
                }
            });
            return true;
        } catch (RejectedExecutionException rejected) {
            finished();
            return false;
        }
    }

    /**
     * Waits until every accepted batch finished. Used by graceful shutdown and
     * by tests that must observe completion, never by a request thread.
     */
    public boolean awaitIdle(Duration timeout) {
        long deadline = System.nanoTime() + timeout.toNanos();
        synchronized (idleMonitor) {
            while (pending > 0) {
                long remaining = deadline - System.nanoTime();
                if (remaining <= 0) {
                    return false;
                }
                try {
                    TimeUnit.NANOSECONDS.timedWait(idleMonitor, remaining);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    return false;
                }
            }
            return true;
        }
    }

    @PreDestroy
    public void close() {
        workers.shutdown();
        try {
            if (!workers.awaitTermination(5, TimeUnit.SECONDS)) {
                workers.shutdownNow();
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            workers.shutdownNow();
        }
    }

    private void finished() {
        synchronized (idleMonitor) {
            pending--;
            if (pending == 0) {
                idleMonitor.notifyAll();
            }
        }
    }
}
