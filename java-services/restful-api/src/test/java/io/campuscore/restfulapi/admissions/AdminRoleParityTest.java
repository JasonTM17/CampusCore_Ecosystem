package io.campuscore.restfulapi.admissions;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.campuscore.restfulapi.admissions.service.AdmissionService;
import io.campuscore.restfulapi.careers.service.CareerService;
import io.campuscore.restfulapi.library.service.LibraryService;
import io.campuscore.restfulapi.notification.repository.NotificationWriteRepository;
import io.campuscore.restfulapi.web.DomainException;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.Named;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;

/**
 * Role parity: grant administration accepts the admin set used everywhere else
 * in the codebase — {@code ADMIN} or {@code SUPER_ADMIN} — not ADMIN alone.
 * A SUPER_ADMIN-only caller must reach the revoke path; a caller with neither
 * role keeps the same FORBIDDEN error code.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AdminRoleParityTest {

    @FunctionalInterface
    private interface StaffGrantAdmin {
        void revokeStaff(String actorId, List<String> roles, String grantId);
    }

    private final NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);

    private Stream<Arguments> services() {
        // Constructor probes the dialect; report non-PostgreSQL.
        JdbcOperations operations = mock(JdbcOperations.class);
        when(operations.execute(any(ConnectionCallback.class))).thenReturn(false);
        when(jdbc.getJdbcOperations()).thenReturn(operations);
        NotificationWriteRepository notifications = mock(NotificationWriteRepository.class);
        AdmissionService admissions = new AdmissionService(jdbc, notifications,
                mock(tools.jackson.databind.ObjectMapper.class));
        CareerService careers = new CareerService(jdbc, notifications);
        LibraryService library = new LibraryService(jdbc, notifications, 48, 14);
        return Stream.of(
                Arguments.of(Named.of("admissions",
                        (StaffGrantAdmin) admissions::revokeStaff)),
                Arguments.of(Named.of("careers",
                        (StaffGrantAdmin) careers::revokeStaff)),
                Arguments.of(Named.of("library",
                        (StaffGrantAdmin) library::revokeStaff)));
    }

    @ParameterizedTest(name = "{0}: SUPER_ADMIN alone reaches grant administration")
    @MethodSource("services")
    void superAdminAloneIsAccepted(StaffGrantAdmin service) {
        when(jdbc.queryForObject(anyString(), any(SqlParameterSource.class), eq(String.class)))
                .thenReturn("user-1");
        when(jdbc.queryForMap(anyString(), any(SqlParameterSource.class)))
                .thenReturn(Map.of("userId", "user-1", "organizationId", ""));
        when(jdbc.queryForObject(anyString(), any(SqlParameterSource.class), eq(Integer.class)))
                .thenReturn(0);
        when(jdbc.queryForObject(anyString(), any(SqlParameterSource.class), eq(Long.class)))
                .thenReturn(0L);
        when(jdbc.update(anyString(), any(SqlParameterSource.class))).thenReturn(1);

        assertThatCode(() -> service.revokeStaff("admin-1", List.of("SUPER_ADMIN"), "grant-1"))
                .doesNotThrowAnyException();
    }

    @ParameterizedTest(name = "{0}: neither admin role is refused with the same error")
    @MethodSource("services")
    void nonAdminIsStillRefused(StaffGrantAdmin service) {
        assertThatThrownBy(() -> service.revokeStaff("admin-1", List.of("LECTURER"), "grant-1"))
                .isInstanceOf(DomainException.class)
                .satisfies(thrown -> {
                    DomainException rejection = (DomainException) thrown;
                    assertThat(rejection.getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(rejection.code()).endsWith("_ADMIN_REQUIRED");
                });
    }
}
