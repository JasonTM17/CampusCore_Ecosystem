package io.campuscore.restfulapi.notification.service;

import io.campuscore.restfulapi.web.DomainException;
import org.springframework.http.HttpStatus;

/**
 * Defense-in-depth mirror of the frontend {@code safeInternalPath} rule:
 * notification links must be safe internal paths so stored links can never
 * redirect users off-site. Null/blank stays allowed (stored as before).
 */
final class NotificationLinkValidator {

    private NotificationLinkValidator() {
    }

    static String requireSafe(String link) {
        if (link == null) {
            return null;
        }
        // Edge-trim spaces only; a full trim would also drop newline/tab and let them slip through.
        String trimmed = link.replaceAll("^ +| +$", "");
        if (trimmed.isEmpty()) {
            return trimmed;
        }
        boolean safe = trimmed.startsWith("/")
                && !trimmed.startsWith("//")
                && !trimmed.contains("\\")
                && !trimmed.contains("://")
                && !hasWhitespaceOrControl(trimmed)
                && !trimmed.regionMatches(true, 0, "/%2f", 0, 4)
                && !trimmed.regionMatches(true, 0, "/%5c", 0, 4);
        if (!safe) {
            throw new DomainException(HttpStatus.BAD_REQUEST, "INVALID_NOTIFICATION_LINK",
                    "link must be a safe internal path");
        }
        return trimmed;
    }

    private static boolean hasWhitespaceOrControl(String value) {
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (Character.isWhitespace(c) || Character.isISOControl(c)) {
                return true;
            }
        }
        return false;
    }
}
