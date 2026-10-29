package io.campuscore.restfulapi.security.ratelimit;

import java.time.Clock;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * High-performance, in-memory Sliding Window Rate Limiter.
 * Tracks timestamps per client key with zero third-party dependencies.
 */
@Service
public class RateLimiterService {

    private final Clock clock;
    private final ConcurrentHashMap<String, Bucket> buckets = new ConcurrentHashMap<>();

    public RateLimiterService() {
        this(Clock.systemUTC());
    }

    public RateLimiterService(Clock clock) {
        this.clock = clock;
    }

    /**
     * Checks if a request should be allowed under the given limits.
     *
     * @param key           unique client key (e.g. "ip:1.2.3.4:AUTH_LOGIN" or "user:123:ENROLLMENT")
     * @param maxRequests   maximum number of requests allowed within the window
     * @param windowSeconds duration of the sliding window in seconds
     * @return RateLimitResult indicating allowed/blocked status and HTTP header values
     */
    public RateLimitResult tryAcquire(String key, int maxRequests, int windowSeconds) {
        long windowMillis = (long) windowSeconds * 1000L;
        AtomicReference<RateLimitResult> result = new AtomicReference<>();

        // compute serializes acquisition and eviction for this key. Keeping the
        // bucket lifecycle inside the map operation prevents cleanup from
        // detaching a deque after a caller has looked it up.
        buckets.compute(key, (bucketKey, bucket) -> {
            long now = clock.millis();
            if (bucket == null) {
                bucket = new Bucket(windowMillis);
            } else {
                bucket.effectiveWindowMillis = Math.max(bucket.effectiveWindowMillis, windowMillis);
            }

            long currentWindowStart = now - windowMillis;
            long retentionStart = now - bucket.effectiveWindowMillis;
            while (!bucket.timestamps.isEmpty() && bucket.timestamps.peekFirst() <= retentionStart) {
                bucket.timestamps.pollFirst();
            }

            int requestsInWindow = 0;
            Long oldestInWindow = null;
            for (Long timestamp : bucket.timestamps) {
                if (timestamp > currentWindowStart) {
                    if (oldestInWindow == null) {
                        oldestInWindow = timestamp;
                    }
                    requestsInWindow++;
                }
            }

            if (requestsInWindow < maxRequests) {
                bucket.timestamps.addLast(now);
                requestsInWindow++;
                long oldest = oldestInWindow == null ? now : oldestInWindow;
                long resetEpochSeconds = (oldest + windowMillis + 999L) / 1000L;
                result.set(RateLimitResult.allowed(
                        maxRequests, maxRequests - requestsInWindow, resetEpochSeconds));
            } else {
                long oldest = oldestInWindow == null ? now : oldestInWindow;
                long retryAfterMillis = Math.max(1000L, (oldest + windowMillis) - now);
                long retryAfterSeconds = (retryAfterMillis + 999L) / 1000L;
                long resetEpochSeconds = (oldest + windowMillis + 999L) / 1000L;
                result.set(RateLimitResult.blocked(maxRequests, resetEpochSeconds, retryAfterSeconds));
            }
            return bucket;
        });

        return result.get();
    }

    /**
     * Periodically removes idle/empty client buckets to avoid memory leaks.
     */
    @Scheduled(fixedRate = 60000)
    public void cleanupExpiredBuckets() {
        long now = clock.millis();

        for (String key : buckets.keySet()) {
            buckets.computeIfPresent(key, (bucketKey, bucket) -> {
                Long last = bucket.timestamps.peekLast();
                return last == null || now - last >= bucket.effectiveWindowMillis ? null : bucket;
            });
        }
    }

    private static final class Bucket {
        private final Deque<Long> timestamps = new ArrayDeque<>();
        private long effectiveWindowMillis;

        private Bucket(long effectiveWindowMillis) {
            this.effectiveWindowMillis = effectiveWindowMillis;
        }
    }

    /**
     * Resets a specific key (useful for test assertions).
     */
    public void reset(String key) {
        buckets.remove(key);
    }

    /**
     * Clears all buckets (useful for test resets).
     */
    public void clear() {
        buckets.clear();
    }

    public int getActiveKeyCount() {
        return buckets.size();
    }
}
