package io.campuscore.restfulapi.web;

import static org.assertj.core.api.Assertions.assertThat;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

@EnabledIf("io.campuscore.restfulapi.web.MobileParityPostgresSupport#postgresTargetConfigured")
class ThesisListPagingPostgresIT extends MobileParityPostgresSupport {
    private UUID round() {
        return round(Instant.now());
    }

    private UUID round(Instant now) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_registration_round (id,name,thesis_type,lecturer_submit_start,lecturer_submit_end,registration_start,registration_end,gvpb_deadline,status) VALUES (?,?,'KLTN',?,?,?,?,?,'REGISTRATION_OPEN')",
                id, "PG " + suffix, Timestamp.from(now.minusSeconds(14400)), Timestamp.from(now.minusSeconds(10800)),
                Timestamp.from(now.minusSeconds(7200)), Timestamp.from(now.plusSeconds(86400)), Timestamp.from(now.plusSeconds(172800)));
        return id;
    }

    private UUID topic(UUID round, String state, String owner) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_topic (id,round_id,department_id,title,description,max_groups,status,created_by) VALUES (?,?,?,?,?,1,?,?)",
                id, round, department, "PG same title " + suffix, "Synthetic", state, owner);
        return id;
    }

    private UUID group(UUID round, String profile) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO thesis.thesis_group (id,round_id,leader_student_id,status,approval_status) VALUES (?, ?, ?, 'DRAFT','PENDING')", id, round, profile);
        jdbc.update("INSERT INTO thesis.thesis_group_member (id,group_id,round_id,student_id,member_order,is_leader) VALUES (?,?,?,?,1,TRUE)", UUID.randomUUID(), id, round, profile);
        return id;
    }

    @Test
    void roundsAndTopicsKeepArrayShapeAndOnlyPublishedOrOwnedTopicsCount() throws Exception {
        Instant anchor = Instant.now();
        UUID round = round(anchor);
        List<String> roundIds = new ArrayList<>(List.of(round.toString(), round(anchor).toString(), round(anchor).toString()));
        List<String> published = new ArrayList<>();
        published.add(topic(round, "PUBLISHED", lecturerUser).toString());
        published.add(topic(round, "PUBLISHED", lecturerUser).toString());
        published.add(topic(round, "APPROVED", lecturerUser).toString());
        UUID myDraft = topic(round, "DRAFT", lecturerUser);
        UUID foreignDraft = topic(round, "DRAFT", otherLecturerUser);
        String topics = "/api/v1/thesis/topics?roundId=" + round;
        var rows = assertPaging(topics, student, "id");
        published.sort(Comparator.naturalOrder());
        assertThat(ids(rows, "id")).containsExactlyElementsOf(published);
        assertThat(ids(rows, "id")).doesNotContain(myDraft.toString(), foreignDraft.toString());
        assertThat(ids(assertPaging(topics + "&status=DRAFT", student, "id"), "id")).isEmpty();
        assertThat(ids(assertPaging(topics + "&status=DRAFT", lecturer, "id"), "id")).containsExactly(myDraft.toString());
        assertThat(ids(assertPaging(topics + "&status=DRAFT", otherLecturer, "id"), "id")).containsExactly(foreignDraft.toString());
        roundIds.sort(Comparator.naturalOrder());
        assertThat(ids(assertPaging("/api/v1/thesis/rounds?status=REGISTRATION_OPEN", student, "id"), "id")
                .stream().filter(roundIds::contains).toList()).containsExactlyElementsOf(roundIds);
        assertInvalidPaging(topics);
        assertInvalidPaging("/api/v1/thesis/rounds");
    }

    @Test
    void groupListsAndMinePageOnlyTheCallersMemberships() throws Exception {
        UUID first = round();
        UUID second = round();
        UUID ownOne = group(first, studentProfile);
        UUID ownTwo = group(second, studentProfile);
        UUID foreign = group(first, otherProfile);
        String groups = "/api/v1/thesis/groups?roundId=" + first;
        assertThat(ids(assertPaging(groups, student, "id"), "id")).containsExactly(ownOne.toString());
        assertThat(ids(assertPaging(groups, otherStudent, "id"), "id")).containsExactly(foreign.toString());
        assertThat(ids(assertPaging("/api/v1/thesis/groups/mine", student, "id"), "id"))
                .containsExactlyInAnyOrder(ownOne.toString(), ownTwo.toString());
        assertThat(ids(assertPaging("/api/v1/thesis/groups/mine", otherStudent, "id"), "id"))
                .containsExactly(foreign.toString());
        assertInvalidPaging(groups);
        assertInvalidPaging("/api/v1/thesis/groups/mine");
    }
}
