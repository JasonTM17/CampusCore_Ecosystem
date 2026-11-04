package io.campuscore.restfulapi.thesis.assistant;

import java.util.Set;
import java.util.regex.Pattern;

/** Fail-closed destination policy shared by assistant response boundaries. */
public final class AssistantLinkPolicy {

    private static final Set<String> ALLOWED_DASHBOARD_ROUTES = Set.of(
            "/dashboard",
            "/dashboard/register",
            "/dashboard/enrollments",
            "/dashboard/learn",
            "/dashboard/curriculum",
            "/dashboard/schedule",
            "/dashboard/grades",
            "/dashboard/transcript",
            "/dashboard/conduct",
            "/dashboard/attendance",
            "/dashboard/thesis",
            "/dashboard/certificates",
            "/dashboard/events",
            "/dashboard/announcements",
            "/dashboard/notifications",
            "/dashboard/lecturer",
            "/dashboard/lecturer/schedule",
            "/dashboard/lecturer/grades",
            "/dashboard/lecturer/attendance",
            "/dashboard/assistant-specialized",
            "/dashboard/dean");

    private static final Pattern SCHEME = Pattern.compile("^[a-z][a-z0-9+.-]*:", Pattern.CASE_INSENSITIVE);
    private static final Pattern PUBLISHED_DOC = Pattern.compile(
            "^/docs/[a-z0-9][a-z0-9-]{0,239}(?:\\?rev=[0-9]{1,10})?$");

    private AssistantLinkPolicy() { }

    /** Exposed for conformance checks; callers must not mutate this set. */
    public static Set<String> allowedDashboardRoutes() {
        return ALLOWED_DASHBOARD_ROUTES;
    }

    /**
     * Return the exact allowed relative destination, otherwise {@code null}.
     * No external host or scheme is accepted. The docs route itself resolves
     * through the published-only page/API and accepts only its revision query.
     */
    public static String allowedDestination(String destination) {
        if (destination == null || destination.isEmpty() || destination.length() > 2048) return null;
        if (containsWhitespaceOrControl(destination)
                || destination.indexOf('%') >= 0
                || destination.indexOf('\\') >= 0
                || destination.indexOf('#') >= 0
                || SCHEME.matcher(destination).find()
                || destination.startsWith("//")
                || !destination.startsWith("/")) {
            return null;
        }
        if ("/docs".equals(destination) || PUBLISHED_DOC.matcher(destination).matches()) {
            return destination;
        }
        return ALLOWED_DASHBOARD_ROUTES.contains(destination) ? destination : null;
    }

    private static boolean containsWhitespaceOrControl(String value) {
        for (int offset = 0; offset < value.length();) {
            int codePoint = value.codePointAt(offset);
            if (Character.isWhitespace(codePoint)
                    || Character.isSpaceChar(codePoint)
                    || Character.isISOControl(codePoint)) {
                return true;
            }
            offset += Character.charCount(codePoint);
        }
        return false;
    }
}
