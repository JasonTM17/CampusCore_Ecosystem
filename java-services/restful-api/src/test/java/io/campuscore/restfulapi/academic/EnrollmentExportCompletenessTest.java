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
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.PreparedStatementCallback;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.web.server.ResponseStatusException;

class EnrollmentExportCompletenessTest {

    @Test
    void reportsOverflowWhenBoundedQueryFindsOneRowPastTheExportLimit() throws Exception {
        NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
        when(jdbc.execute(anyString(), any(SqlParameterSource.class), any(PreparedStatementCallback.class)))
                .thenAnswer(invocation -> {
                    PreparedStatementCallback<?> callback = invocation.getArgument(2);
                    PreparedStatement statement = mock(PreparedStatement.class);
                    ResultSet rows = mock(ResultSet.class);
                    when(statement.executeQuery()).thenReturn(rows);
                    AtomicInteger remaining = new AtomicInteger(50_001);
                    when(rows.next()).thenAnswer(next -> remaining.getAndDecrement() > 0);
                    return callback.doInPreparedStatement(statement);
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
        verify(jdbc).execute(anyString(), parameters.capture(), any(PreparedStatementCallback.class));
        assertThat(parameters.getValue().getValue("exportLimit")).isEqualTo(50_001);
    }
}
