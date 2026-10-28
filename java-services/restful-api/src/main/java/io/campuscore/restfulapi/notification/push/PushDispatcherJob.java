package io.campuscore.restfulapi.notification.push;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Optional scheduler; global push and this worker switch must both be enabled. */
@Component
@Profile("persistence")
@EnableScheduling
@ConditionalOnProperty(prefix = "app.notifications.push", name = "dispatcher-enabled",
        havingValue = "true")
public class PushDispatcherJob {

    private final PushDispatcher dispatcher;

    public PushDispatcherJob(PushDispatcher dispatcher) {
        this.dispatcher = dispatcher;
    }

    @Scheduled(fixedDelay = 30_000)
    public void dispatch() {
        dispatcher.dispatchBatch();
    }
}
