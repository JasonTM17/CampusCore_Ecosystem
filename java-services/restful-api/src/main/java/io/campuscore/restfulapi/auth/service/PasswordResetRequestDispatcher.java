package io.campuscore.restfulapi.auth.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

/**
 * Async entry point for forgot-password requests. The endpoint must answer
 * the same generic 200 for every mailbox — including unknown ones — while
 * the lookup/issue work (user read, token insert, audit write) costs
 * measurably more when an account exists. Running it on the shared
 * application executor after the response removes that timing oracle.
 * Failures are logged without the email address or token payload.
 */
@Component
@Profile("persistence")
public class PasswordResetRequestDispatcher {

    private static final Logger log =
            LoggerFactory.getLogger(PasswordResetRequestDispatcher.class);

    private final PasswordResetService passwordResets;

    public PasswordResetRequestDispatcher(PasswordResetService passwordResets) {
        this.passwordResets = passwordResets;
    }

    /**
     * Enqueues the reset-request work on the same executor the mail service
     * uses for {@code sendAsyncHtmlEmail}. The transactional boundary lives
     * inside {@link PasswordResetService#requestReset}, invoked here through
     * its Spring proxy.
     */
    @Async
    public void requestResetAsync(String email, String requestIp) {
        try {
            passwordResets.requestReset(email, requestIp);
        } catch (Exception failure) {
            // Only the failure type is logged — never the mailbox or token.
            log.warn("password reset request processing failed ({})",
                    failure.getClass().getSimpleName());
        }
    }
}
