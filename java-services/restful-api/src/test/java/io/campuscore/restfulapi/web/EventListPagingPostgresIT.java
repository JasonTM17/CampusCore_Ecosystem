package io.campuscore.restfulapi.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

@EnabledIf("io.campuscore.restfulapi.web.MobileParityPostgresSupport#postgresTargetConfigured")
class EventListPagingPostgresIT extends MobileParityPostgresSupport {
    private String event(String name, String state) {
        String id = suffix + "-" + name;
        jdbc.update("INSERT INTO events.\"Event\" (\"id\",\"title\",\"organizer\",\"status\",\"capacity\",\"startsAt\",\"endsAt\",\"ownerId\") VALUES (?,?, 'Synthetic',?,10,?,?,?)",
                id, id, state, Timestamp.from(Instant.parse("2090-01-01T09:00:00Z")), Timestamp.from(Instant.parse("2090-01-01T10:00:00Z")), lecturerUser);
        return id;
    }

    @Test
    void publishedRowsKeepLegacyShapeAndStableTiesAcrossPages() throws Exception {
        String c = event("c", "PUBLISHED");
        String a = event("a", "PUBLISHED");
        String b = event("b", "REGISTRATION_OPEN");
        String hidden = event("draft", "DRAFT");
        var rows = assertPaging("/api/v1/events", student, "id");
        assertThat(ids(rows, "id").stream().filter(id -> id.startsWith(suffix)).toList()).containsExactly(a, b, c);
        assertThat(ids(rows, "id")).doesNotContain(hidden);
        assertThat(ids(assertPaging("/api/v1/events", student, "id"), "id")).isEqualTo(ids(rows, "id"));
        assertInvalidPaging("/api/v1/events");
    }

    @Test
    void registrationPagingSlicesAfterOwnerFiltering() throws Exception {
        String a = event("a", "REGISTRATION_OPEN");
        String b = event("b", "REGISTRATION_OPEN");
        for (String[] row : List.of(new String[]{suffix + "-ra", a, studentUser},
                new String[]{suffix + "-rb", b, studentUser}, new String[]{suffix + "-foreign", a, otherUser})) {
            jdbc.update("INSERT INTO events.\"Registration\" (\"id\",\"eventId\",\"studentId\",\"status\",\"registeredAt\") VALUES (?,?,?,'REGISTERED',?)",
                    row[0], row[1], row[2], Timestamp.from(Instant.parse("2089-01-01T00:00:00Z")));
        }
        jdbc.update("UPDATE events.\"Event\" SET \"registeredCount\"=2 WHERE \"id\"=?", a);
        jdbc.update("UPDATE events.\"Event\" SET \"registeredCount\"=1 WHERE \"id\"=?", b);
        var mine = assertPaging("/api/v1/events/my/registrations", student, "registrationId");
        assertThat(ids(mine, "registrationId")).containsExactly(suffix + "-ra", suffix + "-rb");
        assertThat(ids(assertPaging("/api/v1/events/my/registrations", otherStudent, "registrationId"), "registrationId"))
                .containsExactly(suffix + "-foreign");
        assertInvalidPaging("/api/v1/events/my/registrations");
        mvc.perform(get("/api/v1/events/my/registrations?page=2&limit=2").with(otherStudent))
                .andExpect(status().isOk()).andExpect(header().string(TOTAL, "1")).andExpect(content().json("[]"));
    }
}
