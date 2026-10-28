package io.campuscore.restfulapi.notification.push;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

class PushPropertiesTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(PushConfiguration.class);

    @ParameterizedTest
    @ValueSource(longs = {-1, 0, 60_000, 60_001, Long.MAX_VALUE})
    void enabledPushRejectsNonPositiveTimeoutOrTimeoutAtOrAboveLeaseDuringStartup(long timeoutMs) {
        contextRunner.withPropertyValues(
                "app.notifications.push.enabled=true",
                "app.notifications.push.lease-seconds=60",
                "app.notifications.push.send-timeout-ms=" + timeoutMs)
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure())
                            .hasRootCauseInstanceOf(IllegalStateException.class)
                            .hasRootCauseMessage("app.notifications.push.send-timeout-ms must be > 0 and less than "
                                    + "app.notifications.push.lease-seconds * 1000 when push is enabled");
                });
    }

    @ParameterizedTest
    @ValueSource(longs = {1, 20_000, 59_999})
    void enabledPushAcceptsPositiveTimeoutStrictlyBelowLease(long timeoutMs) {
        contextRunner.withPropertyValues(
                "app.notifications.push.enabled=true",
                "app.notifications.push.lease-seconds=60",
                "app.notifications.push.send-timeout-ms=" + timeoutMs)
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context.getBean(PushProperties.class).getSendTimeoutMs()).isEqualTo(timeoutMs);
                });
    }

    @ParameterizedTest
    @ValueSource(longs = {-1, 0, 60_000, 60_001, Long.MAX_VALUE})
    void disabledPushSkipsTimeoutValidation(long timeoutMs) {
        contextRunner.withPropertyValues(
                "app.notifications.push.enabled=false",
                "app.notifications.push.lease-seconds=60",
                "app.notifications.push.send-timeout-ms=" + timeoutMs)
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context.getBean(PushProperties.class).getSendTimeoutMs()).isEqualTo(timeoutMs);
                });
    }

    @Test
    void enabledPushUsesTwentySecondTimeoutByDefault() {
        contextRunner.withPropertyValues("app.notifications.push.enabled=true")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context.getBean(PushProperties.class).getSendTimeoutMs()).isEqualTo(20_000);
                });
    }

    @Test
    void timeoutComparisonDoesNotOverflowWhenLeaseSecondsAreLarge() {
        contextRunner.withPropertyValues(
                "app.notifications.push.enabled=true",
                "app.notifications.push.lease-seconds=" + Long.MAX_VALUE,
                "app.notifications.push.send-timeout-ms=" + Long.MAX_VALUE)
                .run(context -> assertThat(context).hasNotFailed());
    }

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(PushProperties.class)
    static class PushConfiguration { }
}
