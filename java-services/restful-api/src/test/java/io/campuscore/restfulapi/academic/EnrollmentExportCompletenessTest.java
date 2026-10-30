package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.campuscore.restfulapi.academic.registration.RegistrationService;
import io.campuscore.restfulapi.academic.service.AcademicEnrollmentReadService;
import io.campuscore.restfulapi.academic.service.AcademicMutationService;
import io.campuscore.restfulapi.audit.AdminAuditRecorder;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.web.server.ResponseStatusException;

class EnrollmentExportCompletenessTest {

    @Test
    void reportsOverflowWhenBoundedQueryFindsOneRowPastTheExportLimit() {
        NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
        List<Map<String, Object>> availableRows = Collections.nCopies(50_001, Map.of());
        when(jdbc.queryForList(anyString(), any(SqlParameterSource.class))).thenAnswer(invocation -> {
            SqlParameterSource parameters = invocation.getArgument(1);
            int limit = (Integer) parameters.getValue("exportLimit");
            return availableRows.subList(0, Math.min(limit, availableRows.size()));
        });

        AcademicMutationService service = new AcademicMutationService(
                jdbc,
                mock(AcademicEnrollmentReadService.class),
                mock(RegistrationService.class),
                mock(AdminAuditRecorder.class));

        assertThatThrownBy(() -> service.exportEnrollments(null, null, null, null, null, null))
                .isInstanceOfSatisfying(ResponseStatusException.class, exception ->
                        assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE));

        ArgumentCaptor<SqlParameterSource> parameters = ArgumentCaptor.forClass(SqlParameterSource.class);
        verify(jdbc).queryForList(anyString(), parameters.capture());
        assertThat(parameters.getValue().getValue("exportLimit")).isEqualTo(50_001);
    }
}
