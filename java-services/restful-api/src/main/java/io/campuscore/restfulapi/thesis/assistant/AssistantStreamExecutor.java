package io.campuscore.restfulapi.thesis.assistant;

import java.util.concurrent.ThreadPoolExecutor;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.context.annotation.Primary;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;

/**
 * Direct handoff keeps slow streams off servlet threads without queuing
 * unreserved turns. This instance serves STUDENT streams; the internal RAG
 * callback relay owns a separate {@code assistantInternalStreamExecutor} pool
 * so provider-side results can always be delivered even when every student
 * worker is busy waiting on the provider.
 */
@Component
@Primary
@Profile("persistence")
public final class AssistantStreamExecutor implements DisposableBean, AutoCloseable {
    private final ThreadPoolTaskExecutor workers = new ThreadPoolTaskExecutor();
    private io.micrometer.core.instrument.Counter rejected;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    void bindMetrics(io.micrometer.core.instrument.MeterRegistry registry) {
        String executor = workers.getThreadNamePrefix().contains("internal") ? "internal" : "student";
        io.micrometer.core.instrument.Tags tags = io.micrometer.core.instrument.Tags.of("executor", executor);
        registry.gauge("campuscore.assistant.executor.active", tags, workers, ThreadPoolTaskExecutor::getActiveCount);
        registry.gauge("campuscore.assistant.executor.queued", tags, workers, pool -> pool.getThreadPoolExecutor().getQueue().size());
        registry.gauge("campuscore.assistant.executor.max", tags, workers, ThreadPoolTaskExecutor::getMaxPoolSize);
        rejected = registry.counter("campuscore.assistant.executor.rejected", tags);
    }

    public AssistantStreamExecutor() {
        this("assistant-stream-", 4);
    }

    AssistantStreamExecutor(String threadNamePrefix, int parallelism) {
        workers.setCorePoolSize(parallelism);
        workers.setMaxPoolSize(parallelism);
        workers.setQueueCapacity(0);
        workers.setThreadNamePrefix(threadNamePrefix);
        workers.setDaemon(true);
        workers.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
        workers.initialize();
    }

    public void execute(Runnable task) {
        try {
            workers.execute(task);
        } catch (java.util.concurrent.RejectedExecutionException failure) {
            if (rejected != null) rejected.increment();
            throw failure;
        }
    }

    @Override
    public void destroy() {
        workers.shutdown();
    }

    @Override
    public void close() {
        destroy();
    }
}
