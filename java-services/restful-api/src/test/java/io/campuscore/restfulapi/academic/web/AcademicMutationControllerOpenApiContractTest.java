package io.campuscore.restfulapi.academic.web;

import static org.assertj.core.api.Assertions.assertThat;

import io.campuscore.restfulapi.exception.ErrorResponse;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import java.lang.reflect.Method;
import java.util.Arrays;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.util.MultiValueMap;

class AcademicMutationControllerOpenApiContractTest {

    @Test
    void csvExportDeclares413WithTheSharedErrorEnvelope() throws NoSuchMethodException {
        Method export = AcademicMutationController.class.getDeclaredMethod(
                "exportEnrollments",
                String.class,
                String.class,
                String.class,
                String.class,
                String.class,
                String.class,
                MultiValueMap.class);
        ApiResponses declaredResponses = export.getAnnotation(ApiResponses.class);
        assertThat(declaredResponses).isNotNull();

        ApiResponse[] tooLargeResponses = Arrays.stream(declaredResponses.value())
                .filter(response -> "413".equals(response.responseCode()))
                .toArray(ApiResponse[]::new);

        assertThat(tooLargeResponses).hasSize(1);
        assertThat(tooLargeResponses[0].content()).hasSize(1);
        Content content = tooLargeResponses[0].content()[0];
        assertThat(content.mediaType()).isEqualTo(MediaType.APPLICATION_JSON_VALUE);
        assertThat(content.schema().implementation()).isEqualTo(ErrorResponse.class);
    }
}
