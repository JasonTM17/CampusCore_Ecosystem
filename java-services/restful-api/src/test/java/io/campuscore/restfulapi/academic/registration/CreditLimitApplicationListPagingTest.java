package io.campuscore.restfulapi.academic.registration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

class CreditLimitApplicationListPagingTest {

    @Test
    void cappedDefaultListReportsTotalCount() {
        NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
        when(jdbc.queryForList(anyString(), any(MapSqlParameterSource.class))).thenReturn(List.of());
        when(jdbc.queryForObject(anyString(), any(MapSqlParameterSource.class), eq(Long.class)))
                .thenReturn(501L);

        CreditLimitApplicationService service = new CreditLimitApplicationService(jdbc);

        var result = service.listPage("PENDING", null);

        assertThat(result.items()).isEmpty();
        assertThat(result.total()).isEqualTo(501L);
    }
}
