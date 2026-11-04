package io.campuscore.restfulapi.auth.service;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.campuscore.restfulapi.audit.AdminAuditRecorder;
import io.campuscore.restfulapi.auth.repository.AuthUserRepository;
import io.campuscore.restfulapi.web.DomainException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * The pre-delete audit probe in {@link AdminUserMutationService#delete}
 * tolerates only a missing row. A real data-access failure inside that
 * @Transactional method would abort the whole transaction on PostgreSQL, so
 * it must fail fast instead of being swallowed.
 */
class AdminUserMutationServiceDeleteProbeTest {

    /** Only find()'s user snapshot query selects hasStudentProfile. */
    private static final String FIND_SQL = "hasStudentProfile";

    private final NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
    private final AdminUserMutationService service = new AdminUserMutationService(
            jdbc,
            mock(PasswordEncoder.class),
            mock(AuthUserRepository.class),
            mock(AdminAuditRecorder.class));

    @Test
    void dataAccessFailureInAuditProbePropagates() {
        stubHappyPath();
        when(jdbc.queryForMap(argThat(sql -> sql.contains(FIND_SQL)), any(SqlParameterSource.class)))
                .thenThrow(new DataAccessResourceFailureException("backend unavailable"));

        assertThatThrownBy(() -> service.delete("user-1", true))
                .isInstanceOf(DataAccessResourceFailureException.class);
    }

    @Test
    void missingRowInAuditProbeStillFallsThroughToNotFound() {
        stubHappyPath();
        when(jdbc.queryForMap(argThat(sql -> sql.contains(FIND_SQL)), any(SqlParameterSource.class)))
                .thenThrow(new EmptyResultDataAccessException(1));
        when(jdbc.update(anyString(), any(SqlParameterSource.class))).thenReturn(0);

        assertThatThrownBy(() -> service.delete("user-1", true))
                .isInstanceOf(DomainException.class)
                .satisfies(thrown -> org.assertj.core.api.Assertions.assertThat(
                                ((DomainException) thrown).getStatus())
                        .isEqualTo(HttpStatus.NOT_FOUND));
    }

    private void stubHappyPath() {
        when(jdbc.queryForMap(anyString(), any(SqlParameterSource.class)))
                .thenReturn(Map.of());
        when(jdbc.queryForList(anyString(), any(SqlParameterSource.class), eq(String.class)))
                .thenReturn(List.of());
        when(jdbc.queryForObject(anyString(), any(SqlParameterSource.class), eq(Long.class)))
                .thenReturn(0L);
        when(jdbc.queryForObject(anyString(), any(SqlParameterSource.class), eq(Integer.class)))
                .thenReturn(0);
    }
}
