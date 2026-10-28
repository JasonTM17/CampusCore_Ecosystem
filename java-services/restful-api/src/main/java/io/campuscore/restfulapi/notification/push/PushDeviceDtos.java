package io.campuscore.restfulapi.notification.push;

import io.campuscore.restfulapi.exception.AppException;
import java.time.Instant;
import java.util.Set;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;
import org.springframework.http.HttpStatus;

/** Request and redacted response DTOs for owner-scoped push registration. */
public final class PushDeviceDtos {

    private static final Set<String> REQUEST_FIELDS = Set.of("provider", "platform", "token");

    private PushDeviceDtos() { }

    public record RegistrationRequest(String provider, String platform, String token) {
        public static RegistrationRequest from(JsonNode body) {
            if (!(body instanceof ObjectNode object)) {
                throw invalidRequest();
            }
            for (String field : object.propertyNames()) {
                if (!REQUEST_FIELDS.contains(field)) {
                    throw invalidRequest();
                }
            }
            String provider = stringField(object, "provider");
            String platform = stringField(object, "platform");
            String token = stringField(object, "token");
            if (provider == null || platform == null || token == null) {
                throw invalidRequest();
            }
            return new RegistrationRequest(provider, platform, token);
        }

        private static String stringField(ObjectNode body, String field) {
            JsonNode value = body.get(field);
            return value != null && value.isTextual() ? value.asText() : null;
        }
    }

    public record RegistrationResponse(
            String installationId,
            String provider,
            String platform,
            String status,
            Instant updatedAt) { }

    private static AppException invalidRequest() {
        return new AppException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                "Push device registration request is invalid");
    }
}
