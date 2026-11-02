package io.campuscore.restfulapi.academic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.when;

import io.campuscore.restfulapi.academic.repository.AdminAnalyticsRepository;
import io.campuscore.restfulapi.academic.service.AdminAnalyticsService;
import io.campuscore.restfulapi.academic.web.AdminAnalyticsDtos.Totals;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.mockito.invocation.Invocation;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;

/** The overview is one dashboard load: its statement count must stay fixed. */
class AdminAnalyticsStatementBudgetTest {

    private static final Set<String> SQL_METHODS =
            Set.of("query", "queryForObject", "queryForList", "update", "batchUpdate");

    @Test
    void overviewRunsAtMostFiveStatements() {
        NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
        JdbcOperations operations = mock(JdbcOperations.class);
        when(jdbc.getJdbcOperations()).thenReturn(operations);
        doReturn(List.of()).when(jdbc).query(anyString(), any(RowMapper.class));
        doReturn(List.of()).when(jdbc)
                .query(anyString(), any(SqlParameterSource.class), any(RowMapper.class));
        when(jdbc.queryForObject(anyString(), any(SqlParameterSource.class), any(RowMapper.class)))
                .thenReturn(new Totals(0, 0, 0, 0));
        when(operations.queryForObject(anyString(), any(Class.class))).thenReturn(0L);

        new AdminAnalyticsService(new AdminAnalyticsRepository(jdbc)).overview();

        assertThat(sqlStatements(jdbc, operations)).isLessThanOrEqualTo(5);
    }

    private static long sqlStatements(NamedParameterJdbcTemplate jdbc, JdbcOperations operations) {
        return Stream.concat(
                        mockingDetails(jdbc).getInvocations().stream(),
                        mockingDetails(operations).getInvocations().stream())
                .map(Invocation::getMethod)
                .map(java.lang.reflect.Method::getName)
                .filter(SQL_METHODS::contains)
                .count();
    }
}
