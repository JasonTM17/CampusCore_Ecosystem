package io.campuscore.restfulapi.notification.web;

import io.campuscore.restfulapi.exception.ValidationException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/** DTOs for notification inbox mutations. */
public final class NotificationWriteDtos {

    private static final Set<String> WRITE_FIELDS = Set.of(
            "userId",
            "title",
            "message",
            "type",
            "link");

    // Persisted column caps (notifications.notification).
    private static final int USER_ID_MAX = 120;
    private static final int TITLE_MAX = 240;
    private static final int MESSAGE_MAX = 2000;
    private static final int TYPE_MAX = 60;
    private static final int LINK_MAX = 500;

    private NotificationWriteDtos() {
    }

    public record UpdateNotificationRequest(
            Set<String> presentFields,
            String userId,
            String title,
            String message,
            String type,
            String link) {

        public static UpdateNotificationRequest from(JsonNode body) {
            ObjectNode object = objectBody(body);
            Set<String> presentFields = presentAllowedFields(object, WRITE_FIELDS);
            return new UpdateNotificationRequest(
                    Collections.unmodifiableSet(presentFields),
                    bounded(stringValue(object, "userId", false), "userId", USER_ID_MAX),
                    bounded(stringValue(object, "title", false), "title", TITLE_MAX),
                    bounded(stringValue(object, "message", false), "message", MESSAGE_MAX),
                    bounded(stringValue(object, "type", false), "type", TYPE_MAX),
                    bounded(stringValue(object, "link", true), "link", LINK_MAX));
        }

        public boolean has(String field) {
            return presentFields.contains(field);
        }
    }

    public record CreateNotificationRequest(
            String userId,
            String title,
            String message,
            String type,
            String link) {

        public static CreateNotificationRequest from(JsonNode body) {
            ObjectNode object = objectBody(body);
            Set<String> presentFields = presentAllowedFields(object, WRITE_FIELDS);
            requirePresent(presentFields, "userId");
            requirePresent(presentFields, "title");
            requirePresent(presentFields, "message");
            requirePresent(presentFields, "type");
            return new CreateNotificationRequest(
                    bounded(stringValue(object, "userId", false), "userId", USER_ID_MAX),
                    bounded(stringValue(object, "title", false), "title", TITLE_MAX),
                    bounded(stringValue(object, "message", false), "message", MESSAGE_MAX),
                    bounded(stringValue(object, "type", false), "type", TYPE_MAX),
                    bounded(stringValue(object, "link", true), "link", LINK_MAX));
        }
    }

    public record MarkAllReadResponse(int updated) {
    }

    public record DeleteNotificationResponse(String message) {
    }

    private static ObjectNode objectBody(JsonNode body) {
        if (body == null || body.isNull()) {
            throw new IllegalArgumentException("request body is required");
        }
        if (!(body instanceof ObjectNode object)) {
            throw new IllegalArgumentException("request body must be an object");
        }
        return object;
    }

    private static Set<String> presentAllowedFields(ObjectNode body, Set<String> allowedFields) {
        Set<String> present = new LinkedHashSet<>();
        for (String field : body.propertyNames()) {
            if (!allowedFields.contains(field)) {
                throw new IllegalArgumentException("Unexpected body property: " + field);
            }
            present.add(field);
        }
        return present;
    }

    private static void requirePresent(Set<String> presentFields, String field) {
        if (!presentFields.contains(field)) {
            throw new IllegalArgumentException(field + " is required");
        }
    }

    private static String stringValue(ObjectNode body, String field, boolean allowNull) {
        if (!body.has(field)) {
            return null;
        }
        JsonNode value = body.get(field);
        if (value.isNull()) {
            if (allowNull) {
                return null;
            }
            throw new IllegalArgumentException(field + " must be a string");
        }
        if (!value.isTextual()) {
            throw new IllegalArgumentException(field + " must be a string");
        }
        return value.asText();
    }

    private static String bounded(String value, String field, int max) {
        if (value != null && value.length() > max) {
            throw new ValidationException("Request validation failed",
                    Map.of(field, field + " must be at most " + max + " characters"));
        }
        return value;
    }
}
