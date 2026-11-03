package io.campuscore.restfulapi.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.academic.registration.CreditLimitApplicationDtos;
import io.campuscore.restfulapi.academic.registration.RegistrationDtos;
import io.campuscore.restfulapi.academic.web.AcademicAttendanceReadDtos;
import io.campuscore.restfulapi.academic.web.AcademicEnrollmentReadDtos;
import io.campuscore.restfulapi.academic.web.AcademicReadDtos;
import io.campuscore.restfulapi.academic.web.AcademicSectionReadDtos;
import io.campuscore.restfulapi.admissions.web.AdmissionDtos;
import io.campuscore.restfulapi.attendance.AttendanceDtos;
import io.campuscore.restfulapi.careers.web.CareerDtos;
import io.campuscore.restfulapi.engagement.web.AnnouncementReadDtos;
import io.campuscore.restfulapi.events.web.EventDtos;
import io.campuscore.restfulapi.library.web.LibraryDtos;
import io.campuscore.restfulapi.learning.web.LearningDtos;
import io.campuscore.restfulapi.people.web.PeopleReadDtos;
import io.campuscore.restfulapi.thesis.assistant.ThesisAssistantController;
import io.campuscore.restfulapi.thesis.assistant.ThesisAssistantDtos;
import io.campuscore.restfulapi.thesis.assistant.ThesisAssistantInternalController;
import io.campuscore.restfulapi.thesis.web.ThesisRoundDtos;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
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
    void collidingDtoTypesUseDistinctComponentNames() {
        List<Class<?>> dtoTypes = List.of(
                AdmissionDtos.ApplicationResponse.class,
                CareerDtos.ApplicationResponse.class,
                RegistrationDtos.RoundResponse.class,
                ThesisRoundDtos.RoundResponse.class,
                LearningDtos.FeedbackResponse.class,
                ThesisAssistantDtos.FeedbackResponse.class,
                ThesisAssistantController.FeedbackResponse.class,
                ThesisAssistantInternalController.FeedbackResponse.class,
                AttendanceDtos.ReviewRequest.class,
                CreditLimitApplicationDtos.ReviewRequest.class,
                AcademicAttendanceReadDtos.CourseSummary.class,
                AcademicEnrollmentReadDtos.CourseSummary.class,
                AcademicSectionReadDtos.CourseSummary.class,
                AnnouncementReadDtos.CourseSummary.class,
                AcademicAttendanceReadDtos.SectionSummary.class,
                AcademicEnrollmentReadDtos.SectionSummary.class,
                AnnouncementReadDtos.SectionSummary.class,
                AcademicSectionReadDtos.LecturerSummary.class,
                AcademicEnrollmentReadDtos.LecturerSummary.class,
                AnnouncementReadDtos.LecturerSummary.class,
                AcademicSectionReadDtos.SemesterSummary.class,
                AcademicEnrollmentReadDtos.SemesterSummary.class,
                AnnouncementReadDtos.SemesterSummary.class,
                CareerDtos.StaffGrantResponse.class,
                AdmissionDtos.StaffGrantResponse.class,
                LibraryDtos.StaffGrantResponse.class,
                EventDtos.StaffGrantResponse.class,
                CareerDtos.TransitionRequest.class,
                AdmissionDtos.TransitionRequest.class,
                AcademicReadDtos.DepartmentSummary.class,
                AcademicSectionReadDtos.DepartmentSummary.class,
                PeopleReadDtos.DepartmentSummary.class);

        List<String> componentNames = dtoTypes.stream().map(OpenApiAccuracyContractTest::componentName).toList();

        assertThat(new HashSet<>(componentNames))
                .as("different DTO classes must not resolve to the same SpringDoc component name")
                .hasSameSizeAs(dtoTypes);
    }

    @Test
    void existingComponentsKeepTheirNames() throws Exception {
        JsonNode schemas = openApiDocument().path("components").path("schemas");

        assertSchemaHasFields(schemas, "ApplicationResponse", "applicantUserId", "cycle", "fullName");
        assertSchemaHasFields(schemas, "RoundResponse", "thesisType", "defenseDate", "gvpbDeadline");
        assertSchemaHasFields(schemas, "FeedbackResponse", "messageId", "rating", "removed");
        assertSchemaHasFields(schemas, "ReviewRequest", "decision", "note");
        assertSchemaHasFields(schemas, "StaffGrantResponse", "userId", "scope", "createdAt");
        assertSchemaHasFields(schemas, "CourseSummary", "code", "name");
        assertSchemaHasFields(schemas, "SectionSummary", "sectionNumber", "course");
        assertSchemaHasFields(schemas, "LecturerSummary", "id", "displayName");
        assertSchemaHasFields(schemas, "SemesterSummary", "name");
        assertSchemaHasFields(schemas, "TransitionRequest", "expectedVersion");
        assertSchemaHasFields(schemas, "CareerTransitionRequest", "expectedVersion", "reason");
        assertSchemaHasFields(schemas, "DepartmentSummary", "id", "code", "name");
        assertSchemaHasFields(schemas, "CatalogDepartmentSummary", "nameEn", "nameVi", "facultyId");
    }

    @Test
    void careerApplicationResponseHasItsOwnComponent() throws Exception {
        JsonNode schemas = openApiDocument().path("components").path("schemas");

        assertSchemaHasFields(schemas, "CareerApplicationResponse", "opportunityId", "organizationId", "coverLetter");
    }

    @Test
    void registrationAndThesisRoundsHaveSeparateComponents() throws Exception {
        JsonNode schemas = openApiDocument().path("components").path("schemas");

        assertSchemaHasFields(schemas, "RegistrationRoundResponse", "semesterId", "windowStart", "creditLimit");
        assertSchemaHasFields(schemas, "RoundResponse", "thesisType", "defenseDate", "gvpbDeadline");
    }

    @Test
    void learningFeedbackHasItsOwnComponent() throws Exception {
        JsonNode schemas = openApiDocument().path("components").path("schemas");

        assertSchemaHasFields(schemas, "LearningFeedbackResponse", "submissionId", "score", "comment");
    }

    @Test
    void attendanceReviewSchemaIncludesItsExistingConstraints() throws Exception {
        JsonNode schema = openApiDocument().path("components").path("schemas").path("AttendanceReviewRequest");

        assertThat(schema.path("required").toString()).contains("decision", "note");
        assertThat(schema.path("properties").path("decision").path("pattern").asText())
                .contains("APPROVE", "REJECT");
    }

    @Test
    void academicSectionCourseSummaryKeepsItsFields() throws Exception {
        JsonNode schemas = openApiDocument().path("components").path("schemas");

        assertSchemaHasFields(schemas, "SectionCourseSummary", "credits", "nameEn", "nameVi", "department");
    }

    @Test
    void academicSectionLecturerSummaryKeepsItsFields() throws Exception {
        JsonNode schemas = openApiDocument().path("components").path("schemas");

        assertSchemaHasFields(schemas, "SectionLecturerSummary", "employeeId", "user");
    }

    @Test
    void academicSectionSemesterSummaryKeepsItsFields() throws Exception {
        JsonNode schemas = openApiDocument().path("components").path("schemas");

        assertSchemaHasFields(schemas, "SectionSemesterSummary", "id", "nameEn", "nameVi", "startDate");
    }

    @Test
    void enrollmentSectionSummaryHasItsOwnComponent() throws Exception {
        JsonNode schemas = openApiDocument().path("components").path("schemas");

        assertSchemaHasFields(schemas, "EnrollmentSectionSummary", "lecturer", "schedules", "capacity");
    }

    @Test
    void careerStaffGrantSchemaIncludesOrganization() throws Exception {
        JsonNode schemas = openApiDocument().path("components").path("schemas");

        assertSchemaHasFields(schemas, "CareerStaffGrantResponse", "organizationId", "userId", "scope");
    }

    @Test
    void geofenceCreateDocumentsCreatedStatus() throws Exception {
        JsonNode responses = operation(openApiDocument(), "post", "/api/v1/admin/attendance/geofences")
                .path("responses");

        assertThat(responses.has("201")).as("creating a geofence returns a documented 201").isTrue();
        assertThat(responses.has("200")).as("creating a geofence does not advertise a 200").isFalse();
    }

    @Test
    void emptyCreditLimitApplicationDocumentsNoContentWithoutBody() throws Exception {
        JsonNode response = operation(openApiDocument(), "get", "/api/v1/me/registration/credit-limit-application")
                .path("responses").path("204");

        assertThat(response.isMissingNode()).isFalse();
        assertThat(response.has("content")).as("204 responses have no body schema").isFalse();
    }

    @Test
    void learningMaterialSchemaReflectsItsDtoConstraints() throws Exception {
        JsonNode schema = openApiDocument().path("components").path("schemas").path("MaterialUpsertRequest");

        assertThat(schema.path("required").toString()).contains("title");
        assertThat(schema.path("properties").path("title").path("maxLength").asInt()).isEqualTo(300);
        assertThat(schema.path("properties").path("fileName").path("maxLength").asInt()).isEqualTo(300);
        assertThat(schema.path("properties").path("contentType").path("maxLength").asInt()).isEqualTo(120);
        assertThat(schema.path("properties").path("checksum").path("maxLength").asInt()).isEqualTo(128);
    }

    @Test
    void learningAssignmentSchemaReflectsItsDtoConstraints() throws Exception {
        JsonNode schema = openApiDocument().path("components").path("schemas").path("AssignmentUpsertRequest");

        assertThat(schema.path("required").toString()).contains("title");
        assertThat(schema.path("properties").path("title").path("maxLength").asInt()).isEqualTo(300);
        assertThat(schema.path("properties").path("maxScore").path("minimum").asDouble()).isEqualTo(0.0);
    }

    @Test
    void learningSubmissionSchemaReflectsItsDtoConstraints() throws Exception {
        JsonNode schema = openApiDocument().path("components").path("schemas").path("SubmissionUpsertRequest");

        assertThat(schema.path("properties").path("fileName").path("maxLength").asInt()).isEqualTo(300);
        assertThat(schema.path("properties").path("contentType").path("maxLength").asInt()).isEqualTo(120);
        assertThat(schema.path("properties").path("checksum").path("maxLength").asInt()).isEqualTo(128);
    }

    @Test
    void learningScoreSchemasReflectTheirDtoConstraints() throws Exception {
        JsonNode schemas = openApiDocument().path("components").path("schemas");

        assertThat(schemas.path("ReturnRequest").path("properties").path("score").path("minimum").asDouble())
                .isEqualTo(0.0);
        assertThat(schemas.path("SubmissionReviewRequest").path("properties").path("score")
                .path("minimum").asDouble()).isEqualTo(0.0);
    }

    @Test
    void assistantMessageListsDocumentTheirNextCursorHeader() throws Exception {
        JsonNode paths = openApiDocument().path("paths");
        List<String> cursorPaths = new ArrayList<>();

        for (Map.Entry<String, JsonNode> path : paths.properties()) {
            if (!path.getKey().contains("/assistant/")
                    || !(path.getKey().endsWith("/conversations") || path.getKey().endsWith("/messages"))) {
                continue;
            }
            if (path.getValue().has("get")) {
                cursorPaths.add(path.getKey());
                assertThat(path.getValue().path("get").path("responses").path("200")
                        .path("headers").has("X-Next-Cursor"))
                        .as("GET %s documents X-Next-Cursor", path.getKey())
                        .isTrue();
            }
        }

        assertThat(cursorPaths).contains(
                "/api/v1/assistant/conversations",
                "/api/v1/assistant/conversations/{id}/messages",
                "/api/v1/thesis/assistant/conversations",
                "/api/v1/thesis/assistant/conversations/{id}/messages");
    }

    @Test
    void announcementOperationsDocumentTypedRequestBodies() throws Exception {
        JsonNode spec = openApiDocument();

        assertThat(operation(spec, "post", "/api/v1/announcements").path("requestBody").path("content")
                .path("application/json").path("schema").path("$ref").asText())
                .isEqualTo("#/components/schemas/CreateAnnouncementRequest");
        assertThat(operation(spec, "put", "/api/v1/announcements/{id}").path("requestBody").path("content")
                .path("application/json").path("schema").path("$ref").asText())
                .isEqualTo("#/components/schemas/UpdateAnnouncementRequest");
    }

    @Test
    void eventListDocumentsBadRequestForIncompletePaging() throws Exception {
        JsonNode responses = operation(openApiDocument(), "get", "/api/v1/events").path("responses");

        assertThat(responses.has("400")).as("page without limit returns documented 400").isTrue();
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

    private static void assertSchemaHasFields(JsonNode schemas, String schemaName, String... fields) {
        JsonNode schema = schemas.path(schemaName);
        assertThat(schema.isMissingNode()).as("component schema %s exists", schemaName).isFalse();
        for (String field : fields) {
            assertThat(schema.path("properties").has(field))
                    .as("component schema %s includes %s", schemaName, field)
                    .isTrue();
        }
    }

    private static String componentName(Class<?> dtoType) {
        io.swagger.v3.oas.annotations.media.Schema schema =
                dtoType.getAnnotation(io.swagger.v3.oas.annotations.media.Schema.class);
        return schema == null || schema.name().isBlank() ? dtoType.getSimpleName() : schema.name();
    }

}
