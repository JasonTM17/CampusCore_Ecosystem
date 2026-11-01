package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.when;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import io.campuscore.restfulapi.academic.repository.AcademicAttendanceReadRepository;
import io.campuscore.restfulapi.academic.repository.AcademicEnrollmentReadRepository;
import io.campuscore.restfulapi.academic.repository.AcademicSectionReadRepository;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Named;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;

/**
 * The scoped department/faculty access checks stay fail-closed: a data-access
 * failure still denies access, but must log one WARN (exception type only, no
 * ids or parameter values) instead of swallowing the exception silently.
 * Non-data-access failures are programming errors and must propagate.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AcademicSectionAccessGuardTest {

    @FunctionalInterface
    private interface SectionAccessGuard {
        boolean hasSectionAccess(String sectionId, List<String> roles, String lecturerId);
    }

    // MethodSource arguments are resolved before @BeforeEach under PER_CLASS,
    // so the shared mock must exist at construction time and be reset per call.
    private final NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
    private ListAppender<ILoggingEvent> logCapture;
    private List<Logger> repositoryLoggers;

    @BeforeEach
    void prepare() {
        reset(jdbc);
        logCapture = new ListAppender<>();
        logCapture.start();
        repositoryLoggers = Stream.of(
                        AcademicAttendanceReadRepository.class,
                        AcademicEnrollmentReadRepository.class,
                        AcademicSectionReadRepository.class)
                .map(type -> (Logger) LoggerFactory.getLogger(type))
                .toList();
        repositoryLoggers.forEach(logger -> logger.addAppender(logCapture));
    }

    @AfterEach
    void detach() {
        repositoryLoggers.forEach(logger -> logger.detachAppender(logCapture));
        logCapture.stop();
    }

    private Stream<Arguments> guards() {
        return Stream.of(
                Arguments.of(Named.of("attendance",
                        (SectionAccessGuard) new AcademicAttendanceReadRepository(jdbc)::hasSectionAccess)),
                Arguments.of(Named.of("enrollment",
                        (SectionAccessGuard) new AcademicEnrollmentReadRepository(jdbc)::hasSectionAccess)),
                Arguments.of(Named.of("section",
                        (SectionAccessGuard) new AcademicSectionReadRepository(jdbc)::hasSectionAccess)));
    }

    @ParameterizedTest(name = "{0}: data-access failure denies access and logs one WARN")
    @MethodSource("guards")
    void dataAccessFailureDeniesAccessAndLogsOnce(SectionAccessGuard guard) {
        when(jdbc.queryForObject(anyString(), any(SqlParameterSource.class), eq(Long.class)))
                .thenReturn(0L)
                .thenThrow(new DataAccessResourceFailureException("backend unavailable"));

        assertThat(guard.hasSectionAccess("sec-x", List.of("TRUONG_BO_MON"), "lec-x")).isFalse();
        assertThat(logCapture.list)
                .as("exactly one WARN naming the failure type without ids or parameters")
                .hasSize(1)
                .allSatisfy(event -> {
                    assertThat(event.getLevel()).isEqualTo(Level.WARN);
                    assertThat(event.getFormattedMessage())
                            .contains(DataAccessResourceFailureException.class.getSimpleName())
                            .doesNotContain("sec-x")
                            .doesNotContain("lec-x")
                            .doesNotContain("backend unavailable");
                });
    }

    @ParameterizedTest(name = "{0}: positive scoped count still grants access")
    @MethodSource("guards")
    void positiveScopedCountStillGrantsAccess(SectionAccessGuard guard) {
        when(jdbc.queryForObject(anyString(), any(SqlParameterSource.class), eq(Long.class)))
                .thenReturn(0L, 1L);

        assertThat(guard.hasSectionAccess("sec-x", List.of("TRUONG_BO_MON"), "lec-x")).isTrue();
        assertThat(logCapture.list).isEmpty();
    }

    @ParameterizedTest(name = "{0}: non-data-access failures are not swallowed")
    @MethodSource("guards")
    void nonDataAccessFailuresPropagate(SectionAccessGuard guard) {
        when(jdbc.queryForObject(anyString(), any(SqlParameterSource.class), eq(Long.class)))
                .thenReturn(0L)
                .thenThrow(new IllegalStateException("programming error"));

        assertThatThrownBy(() -> guard.hasSectionAccess("sec-x", List.of("TRUONG_BO_MON"), "lec-x"))
                .isInstanceOf(IllegalStateException.class);
    }
}
