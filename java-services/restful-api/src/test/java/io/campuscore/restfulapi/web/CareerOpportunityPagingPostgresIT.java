package io.campuscore.restfulapi.web;

import static org.assertj.core.api.Assertions.assertThat;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

@EnabledIf("io.campuscore.restfulapi.web.MobileParityPostgresSupport#postgresTargetConfigured")
class CareerOpportunityPagingPostgresIT extends MobileParityPostgresSupport {
    @Test
    void onlyPublishedQueryMatchesAreCountedAndPagedWithStableTies() throws Exception {
        String org = "pg-org-" + suffix;
        jdbc.update("INSERT INTO careers.\"Organization\" (\"id\",\"name\") VALUES (?,?)", org, org);
        for (String[] row : List.of(new String[]{"c", "PUBLISHED"}, new String[]{"a", "PUBLISHED"}, new String[]{"b", "PUBLISHED"}, new String[]{"draft", "DRAFT"})) {
            jdbc.update("INSERT INTO careers.\"Opportunity\" (\"id\",\"organizationId\",\"title\",\"status\",\"submittedBy\",\"publishedAt\") VALUES (?,?,?,?,?,?)",
                    suffix + "-" + row[0], org, suffix + " Job " + row[0], row[1], lecturerUser, Timestamp.from(Instant.parse("2090-01-01T00:00:00Z")));
        }
        String url = "/api/v1/careers/opportunities?query=" + suffix;
        var rows = assertPaging(url, student, "id");
        assertThat(ids(rows, "id")).containsExactly(suffix + "-a", suffix + "-b", suffix + "-c");
        assertThat(ids(assertPaging(url, otherStudent, "id"), "id")).isEqualTo(ids(rows, "id"));
        assertInvalidPaging(url);
    }
}
