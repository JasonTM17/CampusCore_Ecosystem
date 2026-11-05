package io.campuscore.restfulapi.web;

import static org.assertj.core.api.Assertions.assertThat;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

@EnabledIf("io.campuscore.restfulapi.web.MobileParityPostgresSupport#postgresTargetConfigured")
class LibraryCataloguePagingPostgresIT extends MobileParityPostgresSupport {
    @Test
    void queryFilteringPrecedesPagingAndTiesRemainStable() throws Exception {
        for (String[] row : List.of(new String[]{"c", "Algorithms"}, new String[]{"a", "Algorithms"}, new String[]{"b", "Networks"})) {
            jdbc.update("INSERT INTO library.\"Title\" (\"id\",\"title\",\"author\") VALUES (?,?,?)", suffix + "-" + row[0], suffix + " " + row[1], "Synthetic");
        }
        String url = "/api/v1/library/catalogue?query=" + suffix;
        var rows = assertPaging(url, student, "id");
        assertThat(ids(rows, "id")).containsExactly(suffix + "-a", suffix + "-c", suffix + "-b");
        assertThat(ids(assertPaging(url, otherStudent, "id"), "id")).isEqualTo(ids(rows, "id"));
        assertInvalidPaging(url);
    }
}
