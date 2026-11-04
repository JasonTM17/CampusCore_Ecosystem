package io.campuscore.restfulapi.notification.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.campuscore.restfulapi.web.DomainException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class NotificationLinkValidatorTest {

    @ParameterizedTest
    @ValueSource(strings = {"/dashboard", "/dashboard/grades?x=1", "  /dashboard ", ""})
    void safeOrBlankLinksAreAccepted(String link) {
        assertThat(NotificationLinkValidator.requireSafe(link)).isNotNull();
    }

    @Test
    void nullLinkIsAllowed() {
        assertThat(NotificationLinkValidator.requireSafe(null)).isNull();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "//evil.example", "/\\evil.example", "https://evil.example",
            "javascript:alert(1)", "/%2f%2fevil", "/%5Cevil", "/a b"})
    void unsafeLinksAreRejected(String link) {
        assertThatThrownBy(() -> NotificationLinkValidator.requireSafe(link))
                .isInstanceOf(DomainException.class)
                .hasMessageContaining("safe internal path")
                .satisfies(e -> assertThat(((DomainException) e).getCode())
                        .isEqualTo("INVALID_NOTIFICATION_LINK"));
    }

    @Test
    void newlineInLinkIsRejected() {
        assertThatThrownBy(() -> NotificationLinkValidator.requireSafe("/a\n"))
                .isInstanceOf(DomainException.class);
    }
}
