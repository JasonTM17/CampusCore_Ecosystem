package io.campuscore.restfulapi.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:openapi_accuracy;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "identity.oidc.enabled=true",
        "identity.oidc.dev-keygen=true",
        "identity.oidc.issuer-uri=http://127.0.0.1:4010",
        "identity.oidc.token-encryption-key=dGVzdC1rZXktMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY=",
        "identity.bff.enabled=true",
        "identity.bff.dev-http=true",
        "identity.bff.surfaces[0].id=portal",
        "identity.bff.surfaces[0].mode=BFF",
        "identity.bff.surfaces[0].client-id=cu-portal",
        "identity.bff.surfaces[0].client-secret=bff-portal-secret-0123456789abcdef",
        "identity.bff.surfaces[0].proxy-secret=proxy-portal-secret-0123456789ab",
        "identity.bff.surfaces[0].public-base-url=http://portal.test",
        "identity.bff.surfaces[0].hosts[0]=portal.test"
})
class OpenApiAccuracyContractTest {

    private static final String ERROR_SCHEMA = "#/components/schemas/ErrorResponse";
    private static final Set<String> OPERATIONS_REQUIRING_IDEMPOTENCY_KEY = Set.of(
            "POST /api/v1/admissions/applications",
            "POST /api/v1/admissions/applications/{applicationId}/attachments",
            "DELETE /api/v1/admissions/applications/{applicationId}/attachments/{attachmentId}",
            "POST /api/v1/admissions/applications/{applicationId}/submit",
            "POST /api/v1/admissions/applications/{applicationId}/withdraw",
            "POST /api/v1/careers/applications",
            "POST /api/v1/careers/applications/{applicationId}/attachments",
            "POST /api/v1/careers/applications/{applicationId}/withdraw",
            "POST /api/v1/enrollments/enroll",
            "POST /api/v1/enrollments/{id}/drop",
            "POST /api/v1/events/registrations/{registrationId}/cancel",
            "POST /api/v1/events/{eventId}/register",
            "POST /api/v1/learning/assignments/{assignmentId}/draft",
            "POST /api/v1/learning/assignments/{assignmentId}/resubmit",
            "POST /api/v1/learning/assignments/{assignmentId}/submit",
            "POST /api/v1/library/requests",
            "POST /api/v1/library/requests/{requestId}/cancel",
            "POST /api/v1/me/enrollments",
            "POST /api/v1/me/enrollments/{id}/drop");

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void documentsErrorResponsesWithTheStandardEnvelope() throws Exception {
        JsonNode spec = openApiDocument();
        JsonNode paths = spec.path("paths");

        for (Map.Entry<String, JsonNode> path : paths.properties()) {
            for (Map.Entry<String, JsonNode> method : path.getValue().properties()) {
                JsonNode responses = method.getValue().path("responses");
                for (Map.Entry<String, JsonNode> response : responses.properties()) {
                    if (!response.getKey().matches("[45][0-9]{2}")) {
                        continue;
                    }

                    String operation = method.getKey().toUpperCase() + " " + path.getKey();
                    JsonNode content = response.getValue().path("content");
                    assertThat(content.isObject())
                            .as("%s %s must document an error body", operation, response.getKey())
                            .isTrue();
                    for (Map.Entry<String, JsonNode> mediaType : content.properties()) {
                        assertThat(mediaType.getValue().path("schema").path("$ref").asText())
                                .as("%s %s %s schema", operation, response.getKey(), mediaType.getKey())
                                .isEqualTo(ERROR_SCHEMA);
                    }
                }
            }
        }
    }

    @Test
    void requiresIdempotencyKeysOnlyForOperationsThatValidateThem() throws Exception {
        JsonNode spec = openApiDocument();
        Set<String> requiredOperations = new HashSet<>();
        JsonNode paths = spec.path("paths");

        for (Map.Entry<String, JsonNode> path : paths.properties()) {
            for (Map.Entry<String, JsonNode> method : path.getValue().properties()) {
                for (JsonNode parameter : method.getValue().path("parameters")) {
                    if ("Idempotency-Key".equals(parameter.path("name").asText())
                            && "header".equals(parameter.path("in").asText())
                            && parameter.path("required").asBoolean()) {
                        requiredOperations.add(method.getKey().toUpperCase() + " " + path.getKey());
                    }
                }
            }
        }

        assertThat(requiredOperations).isEqualTo(OPERATIONS_REQUIRING_IDEMPOTENCY_KEY);

        JsonNode nonIdempotentOperation = operation(spec, "post", "/api/v1/me/registration/credit-limit-applications");
        JsonNode optionalKey = parameter(nonIdempotentOperation, "Idempotency-Key");
        assertThat(optionalKey.isMissingNode() || !optionalKey.path("required").asBoolean())
                .as("credit-limit application submission does not require an Idempotency-Key")
                .isTrue();
    }

    @Test
    void documentsRedirectAndNoContentSuccessStatuses() throws Exception {
        JsonNode spec = openApiDocument();

        for (String redirectPath : Set.of("/session/login", "/session/callback")) {
            JsonNode responses = operation(spec, "get", redirectPath).path("responses");
            assertThat(responses.has("302")).as("GET %s documents its redirect", redirectPath).isTrue();
            assertThat(responses.has("200")).as("GET %s does not document a 200", redirectPath).isFalse();
            assertThat(responses.path("302").has("content"))
                    .as("GET %s redirect has no response body", redirectPath)
                    .isFalse();
        }

        JsonNode topicReport = operation(spec, "get", "/api/v1/thesis/topics/{id}/report").path("responses");
        assertThat(topicReport.has("204")).isTrue();
        assertThat(topicReport.path("204").has("content")).isFalse();
        assertThat(topicReport.has("200")).isTrue();
    }

    @Test
    void documentsQueryParameterMapsAsOptionalFreeFormStringMaps() throws Exception {
        JsonNode paths = openApiDocument().path("paths");
        int count = 0;

        for (Map.Entry<String, JsonNode> path : paths.properties()) {
            for (Map.Entry<String, JsonNode> method : path.getValue().properties()) {
                for (JsonNode parameter : method.getValue().path("parameters")) {
                    if (!"queryParameters".equals(parameter.path("name").asText())) {
                        continue;
                    }

                    count++;
                    assertThat(parameter.path("required").asBoolean())
                            .as("%s %s queryParameters required", method.getKey(), path.getKey())
                            .isFalse();
                    assertThat(parameter.path("schema").path("type").asText())
                            .as("%s %s queryParameters schema type", method.getKey(), path.getKey())
                            .isEqualTo("object");
                    assertThat(parameter.path("schema").path("additionalProperties").path("type").asText())
                            .as("%s %s queryParameters value type", method.getKey(), path.getKey())
                            .isEqualTo("string");
                }
            }
        }

        assertThat(count).as("operations documenting a queryParameters map").isGreaterThanOrEqualTo(35);
    }

    private JsonNode openApiDocument() throws Exception {
        MvcResult result = mvc.perform(get("/v3/api-docs").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString());
    }

    private static JsonNode operation(JsonNode spec, String method, String path) {
        return spec.path("paths").path(path).path(method);
    }

    private static JsonNode parameter(JsonNode operation, String name) {
        for (JsonNode parameter : operation.path("parameters")) {
            if (name.equals(parameter.path("name").asText())) {
                return parameter;
            }
        }
        return operation.path("parameters").path("-1");
    }

}
