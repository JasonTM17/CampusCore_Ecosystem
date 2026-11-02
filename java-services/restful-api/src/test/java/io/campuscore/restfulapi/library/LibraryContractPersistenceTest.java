package io.campuscore.restfulapi.library;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.testsupport.CurrentAccountJwt;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.IntStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * H2 contract test for the P11 library circulation domain (contract §8).
 * Proves the copy/request state machines (LIB-T01..T06), scoped
 * STAFF:library authority (students cannot mutate inventory), one-active-
 * request-per-copy (LIB-X02 service path), server-clock reservation
 * expiry (LIB-X01), idempotent replays (§1.3), return-twice safety (no
 * phantom stock), soft retire keeping loan history, patron isolation and
 * the inactive-user guard on the real controllers + service + H2 mirror
 * DDL.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:library_contract;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "campuscore.library.reservation-ttl-hours=48",
        "campuscore.library.loan-days=14"
})
class LibraryContractPersistenceTest {

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    private RequestPostProcessor borrowerJwt;
    private RequestPostProcessor borrower2Jwt;
    private RequestPostProcessor staffJwt;
    private RequestPostProcessor adminJwt;
    private RequestPostProcessor outsiderJwt;
    private RequestPostProcessor inactiveJwt;

    @BeforeEach
    void fixture() throws Exception {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS campuscore_auth");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS notifications");
        jdbc.execute("DROP SCHEMA IF EXISTS library CASCADE");
        jdbc.execute("DROP TABLE IF EXISTS notifications.notification");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS library");
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS notifications.notification (
                    id VARCHAR(120) PRIMARY KEY,
                    user_id VARCHAR(120) NOT NULL,
                    title VARCHAR(240) NOT NULL,
                    message VARCHAR(2000) NOT NULL,
                    type VARCHAR(60) NOT NULL,
                    link VARCHAR(500),
                    is_read BOOLEAN NOT NULL DEFAULT FALSE,
                    read_at TIMESTAMP WITH TIME ZONE,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
                )""");
        try (java.sql.Connection connection = jdbc.getDataSource().getConnection()) {
            ScriptUtils.executeSqlScript(connection,
                    new ClassPathResource("db/migration-h2/V141__library_schema.sql"));
        }

        borrowerJwt = CurrentAccountJwt.fixtureJwt(jdbc, "borrower-1", "STUDENT");
        borrower2Jwt = CurrentAccountJwt.fixtureJwt(jdbc, "borrower-2", "STUDENT");
        staffJwt = CurrentAccountJwt.fixtureJwt(jdbc, "staff-1", "STUDENT");
        adminJwt = CurrentAccountJwt.fixtureJwt(jdbc, "admin-user", "ADMIN");
        outsiderJwt = CurrentAccountJwt.fixtureJwt(jdbc, "student-9", "STUDENT");
        inactiveJwt = CurrentAccountJwt.fixtureJwt(jdbc, "borrower-suspended", "STUDENT");
        jdbc.update("UPDATE campuscore_auth.\"User\" SET \"status\" = 'SUSPENDED'"
                + " WHERE \"id\" = 'borrower-suspended'");

        // Staff grants are authority assignments — seeded per-test like the
        // events/admissions fixtures (the grant API itself is covered below).
        jdbc.update("DELETE FROM library.\"StaffGrant\"");
        jdbc.update("INSERT INTO library.\"StaffGrant\" (\"id\", \"userId\", \"scope\", \"grantedBy\")"
                + " VALUES ('g-1', 'staff-1', 'library', 'admin-user')");

        // Deterministic catalogue fixture: title-1 with two copies, title-2
        // single copy for the contention leg.
        jdbc.update("INSERT INTO library.\"Title\" (\"id\", \"title\", \"author\", \"category\")"
                + " VALUES ('title-1', 'Demo Algorithms', 'Author A', 'CS')");
        jdbc.update("INSERT INTO library.\"Title\" (\"id\", \"title\", \"author\", \"category\")"
                + " VALUES ('title-2', 'Demo Databases', 'Author B', 'CS')");
        jdbc.update("INSERT INTO library.\"Copy\" (\"id\", \"titleId\", \"barcode\", \"status\")"
                + " VALUES ('copy-1', 'title-1', 'BC-001', 'AVAILABLE')");
        jdbc.update("INSERT INTO library.\"Copy\" (\"id\", \"titleId\", \"barcode\", \"status\")"
                + " VALUES ('copy-2', 'title-1', 'BC-002', 'AVAILABLE')");
        jdbc.update("INSERT INTO library.\"Copy\" (\"id\", \"titleId\", \"barcode\", \"status\")"
                + " VALUES ('copy-3', 'title-2', 'BC-003', 'AVAILABLE')");
    }

    // ---------------------------------------------------------------
    // helpers
    // ---------------------------------------------------------------

    private String requestCopy(RequestPostProcessor borrower, String copyId, String key)
            throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/library/requests")
                        .with(borrower).header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"copyId\":\"" + copyId + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REQUESTED"))
                .andExpect(jsonPath("$.copyId").value(copyId))
                .andExpect(jsonPath("$.expiresAt").isNotEmpty())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).get("id").asText();
    }

    private String copyStatus(String copyId) {
        return jdbc.queryForObject(
                "SELECT \"status\" FROM library.\"Copy\" WHERE \"id\" = ?", String.class, copyId);
    }

    /**
     * Seeds {@code count} REQUESTED rows with unique {@code requestedAt}
     * values, inserted backwards so only the ORDER BY can produce the expected
     * ascending sequence. Every row has a null {@code expiresAt} so the
     * queue's single expiry batch never touches them.
     */
    private void seedQueue(int count) {
        for (int i = count; i >= 1; i--) {
            jdbc.update("INSERT INTO library.\"Copy\" (\"id\", \"titleId\", \"barcode\")"
                            + " VALUES (?, 'title-1', ?)",
                    "qcopy-" + i, "QBC-" + i);
            jdbc.update("INSERT INTO library.\"LoanRequest\" (\"id\", \"copyId\", \"borrowerUserId\","
                            + " \"status\", \"requestedAt\", \"createdAt\")"
                            + " VALUES (?, ?, 'borrower-1', 'REQUESTED', ?, ?)",
                    queueId(i), "qcopy-" + i,
                    java.sql.Timestamp.from(queueRequestedAt(i)),
                    java.sql.Timestamp.from(queueCreatedAt(i)));
        }
    }

    /**
     * Seeds tied rows: groups of three share {@code requestedAt}, two of each
     * group share {@code createdAt}, and the remaining full tie is broken by
     * id. Inserted backwards so neither insertion order nor id order alone can
     * satisfy the expected paged sequence.
     */
    private void seedTiedQueue(int count) {
        for (int i = count; i >= 1; i--) {
            jdbc.update("INSERT INTO library.\"Copy\" (\"id\", \"titleId\", \"barcode\")"
                            + " VALUES (?, 'title-1', ?)",
                    "tcopy-" + i, "TBC-" + i);
            jdbc.update("INSERT INTO library.\"LoanRequest\" (\"id\", \"copyId\", \"borrowerUserId\","
                            + " \"status\", \"requestedAt\", \"createdAt\")"
                            + " VALUES (?, ?, 'borrower-1', 'REQUESTED', ?, ?)",
                    queueId(i), "tcopy-" + i,
                    java.sql.Timestamp.from(tiedRequestedAt(i)),
                    java.sql.Timestamp.from(tiedCreatedAt(i)));
        }
    }

    private void nullableQueueRow(String id, String copyId, Instant requestedAt, Instant createdAt) {
        jdbc.update("INSERT INTO library.\"Copy\" (\"id\", \"titleId\", \"barcode\")"
                + " VALUES (?, 'title-1', ?)", copyId, "NBC-" + copyId);
        jdbc.update("INSERT INTO library.\"LoanRequest\" (\"id\", \"copyId\", \"borrowerUserId\","
                + " \"status\", \"requestedAt\", \"createdAt\")"
                + " VALUES (?, ?, 'borrower-1', 'REQUESTED', ?, ?)",
                id, copyId,
                requestedAt == null ? null : java.sql.Timestamp.from(requestedAt),
                createdAt == null ? null : java.sql.Timestamp.from(createdAt));
    }

    private static String queueId(int i) {
        return String.format("req-%02d", i);
    }

    private static Instant queueRequestedAt(int i) {
        return Instant.parse("2030-01-01T00:00:00Z").plusSeconds(60L * (100 + i));
    }

    private static Instant queueCreatedAt(int i) {
        return Instant.parse("2030-01-01T00:00:00Z");
    }

    private static Instant tiedRequestedAt(int i) {
        return Instant.parse("2030-01-01T00:00:00Z").plusSeconds(60L * (100 - (i + 2) / 3));
    }

    private static Instant tiedCreatedAt(int i) {
        return Instant.parse("2030-01-01T00:00:00Z").plusSeconds(i % 3 == 0 ? 10 : 20);
    }

    private static List<String> expectedQueueOrder(int count) {
        return IntStream.rangeClosed(1, count)
                .mapToObj(LibraryContractPersistenceTest::queueId)
                .toList();
    }

    private static List<String> expectedTiedOrder(int count) {
        return IntStream.rangeClosed(1, count)
                .boxed()
                .sorted(Comparator.comparing(LibraryContractPersistenceTest::tiedRequestedAt)
                        .thenComparing(LibraryContractPersistenceTest::tiedCreatedAt)
                        .thenComparingInt(i -> i))
                .map(LibraryContractPersistenceTest::queueId)
                .toList();
    }

    private List<String> queueIds(MvcResult result) throws Exception {
        List<String> ids = new ArrayList<>();
        for (JsonNode row : objectMapper.readTree(result.getResponse().getContentAsString())) {
            ids.add(row.get("id").asText());
        }
        return ids;
    }

    // ---------------------------------------------------------------
    // contract coverage
    // ---------------------------------------------------------------

    @Test
    void staffQueueKeepsLegacyFullListAndPagesWithMatchingTotal() throws Exception {
        seedQueue(45);

        // No params: the exact legacy body — every row, legacy order, no header.
        List<String> legacy = queueIds(mvc.perform(get("/api/v1/library/staff/requests").with(staffJwt))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("X-Total-Count"))
                .andReturn());
        assertThat(legacy).containsExactlyElementsOf(expectedQueueOrder(45));

        // Pages concatenate back to the legacy body: no skipped or duplicated
        // row.
        List<String> paged = new ArrayList<>();
        for (int page = 0; page <= 3; page++) {
            MvcResult result = mvc.perform(get("/api/v1/library/staff/requests?page=" + page + "&limit=20")
                            .with(staffJwt))
                    .andExpect(status().isOk())
                    .andExpect(header().string("X-Total-Count", "45"))
                    .andReturn();
            List<String> ids = queueIds(result);
            assertThat(ids).hasSize(page < 2 ? 20 : page == 2 ? 5 : 0);
            paged.addAll(ids);
        }
        assertThat(paged).containsExactlyElementsOf(legacy);

        // limit alone is an explicit page 0 under the shared desk convention.
        List<String> firstPage = queueIds(mvc.perform(get("/api/v1/library/staff/requests?limit=7")
                        .with(staffJwt))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Total-Count", "45"))
                .andReturn());
        assertThat(firstPage).containsExactlyElementsOf(legacy.subList(0, 7));
    }

    @Test
    void staffQueueOrdersTiedTimestampsDeterministically() throws Exception {
        seedTiedQueue(45);

        // No params keeps the legacy statement, which has no id key; it still
        // returns every row, but tie order is the database's implicit order.
        assertThat(queueIds(mvc.perform(get("/api/v1/library/staff/requests").with(staffJwt))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("X-Total-Count"))
                .andReturn())).containsExactlyInAnyOrderElementsOf(expectedTiedOrder(45));

        // Paged reads add the id key after both legacy timestamp keys, so every
        // page boundary is deterministic: requestedAt, then createdAt, then id.
        List<String> paged = new ArrayList<>();
        for (int page = 0; page <= 2; page++) {
            paged.addAll(queueIds(mvc.perform(get("/api/v1/library/staff/requests?page=" + page + "&limit=20")
                            .with(staffJwt))
                    .andExpect(status().isOk())
                    .andExpect(header().string("X-Total-Count", "45"))
                    .andReturn()));
        }
        assertThat(paged).containsExactlyElementsOf(expectedTiedOrder(45));

        // The nullable-key leg below exercises the retained NULLS LAST clause.
    }

    @Test
    void staffQueueKeepsNullRequestedAtLastWhenTheKeyIsNullable() throws Exception {
        // Production DDL declares requestedAt and createdAt NOT NULL; this
        // H2-only leg drops that for the fixture so the retained NULLS LAST
        // clause is exercised directly, as it would be if the column ever
        // became nullable.
        jdbc.execute("ALTER TABLE library.\"LoanRequest\" ALTER COLUMN \"requestedAt\" SET NULL");
        jdbc.execute("ALTER TABLE library.\"LoanRequest\" ALTER COLUMN \"createdAt\" SET NULL");
        nullableQueueRow("null-a", "nc-1", null, Instant.parse("2030-01-01T00:03:00Z"));
        nullableQueueRow("set-a", "nc-2", Instant.parse("2030-01-01T00:05:00Z"),
                Instant.parse("2030-01-01T00:01:00Z"));
        nullableQueueRow("null-b", "nc-3", null, Instant.parse("2030-01-01T00:02:00Z"));
        nullableQueueRow("set-b", "nc-4", Instant.parse("2030-01-01T00:04:00Z"),
                Instant.parse("2030-01-01T00:01:00Z"));
        List<String> expected = List.of("set-b", "set-a", "null-b", "null-a");

        assertThat(queueIds(mvc.perform(get("/api/v1/library/staff/requests").with(staffJwt))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("X-Total-Count"))
                .andReturn())).containsExactlyElementsOf(expected);
        assertThat(queueIds(mvc.perform(get("/api/v1/library/staff/requests?page=0&limit=2").with(staffJwt))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Total-Count", "4"))
                .andReturn())).containsExactly("set-b", "set-a");
        assertThat(queueIds(mvc.perform(get("/api/v1/library/staff/requests?page=1&limit=2").with(staffJwt))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Total-Count", "4"))
                .andReturn())).containsExactly("null-b", "null-a");
    }

    @Test
    void staffQueueCountsOnlyTheStatusFilteredRows() throws Exception {
        seedQueue(45);
        for (int i = 1; i <= 45; i += 3) {
            jdbc.update("UPDATE library.\"LoanRequest\" SET \"status\" = 'CANCELLED' WHERE \"id\" = ?",
                    queueId(i));
        }
        List<String> requested = expectedQueueOrder(45).stream()
                .filter(id -> Integer.parseInt(id.substring("req-".length())) % 3 != 1)
                .toList();
        List<String> cancelled = expectedQueueOrder(45).stream()
                .filter(id -> Integer.parseInt(id.substring("req-".length())) % 3 == 1)
                .toList();
        assertThat(requested).hasSize(30);
        assertThat(cancelled).hasSize(15);

        List<String> requestedPages = new ArrayList<>();
        for (int page = 0; page <= 1; page++) {
            requestedPages.addAll(queueIds(mvc.perform(get("/api/v1/library/staff/requests?status=REQUESTED"
                                    + "&page=" + page + "&limit=20").with(staffJwt))
                    .andExpect(status().isOk())
                    .andExpect(header().string("X-Total-Count", "30"))
                    .andReturn()));
        }
        assertThat(requestedPages).containsExactlyElementsOf(requested);

        List<String> legacyFiltered = queueIds(mvc.perform(get("/api/v1/library/staff/requests?status=CANCELLED")
                        .with(staffJwt))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("X-Total-Count"))
                .andReturn());
        assertThat(legacyFiltered).containsExactlyElementsOf(cancelled);

        List<String> cancelledPage = queueIds(mvc.perform(get("/api/v1/library/staff/requests?status=CANCELLED"
                                + "&page=2&limit=5").with(staffJwt))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Total-Count", "15"))
                .andReturn());
        assertThat(cancelledPage).containsExactlyElementsOf(cancelled.subList(10, 15));
    }

    @Test
    void staffQueueRejectsInvalidPagingLikeTheOtherDeskQueues() throws Exception {
        for (String query : List.of("?limit=0", "?limit=-1", "?limit=101", "?page=-1&limit=5", "?page=0")) {
            mvc.perform(get("/api/v1/library/staff/requests" + query).with(staffJwt))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_PAGING"));
        }
        mvc.perform(get("/api/v1/library/staff/requests?page=x&limit=5").with(staffJwt))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        mvc.perform(get("/api/v1/library/staff/requests?page=0&page=1&limit=5").with(staffJwt))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PAGING"));
    }

    @Test
    void fullLifecycleReservesIssuesAndRestoresStock() throws Exception {
        // LIB-T01: request flips copy AVAILABLE → RESERVED.
        String requestId = requestCopy(borrowerJwt, "copy-1", "lc-req-1");
        assertThat(copyStatus("copy-1")).isEqualTo("RESERVED");

        // Catalogue shows the reservation in live availability.
        mvc.perform(get("/api/v1/library/catalogue").with(borrowerJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id=='title-1')].availableCopies").value(org.hamcrest.Matchers.contains(1)));

        // LIB-T02: staff approve inside the hold window.
        mvc.perform(post("/api/v1/library/staff/requests/" + requestId + "/approve")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.approvedBy").value("staff-1"));

        // LIB-T03: issue flips copy RESERVED → ON_LOAN, sets dueAt, clears hold.
        mvc.perform(post("/api/v1/library/staff/requests/" + requestId + "/issue")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":2,\"dueDays\":21}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ISSUED"))
                .andExpect(jsonPath("$.dueAt").isNotEmpty())
                .andExpect(jsonPath("$.expiresAt").doesNotExist());
        assertThat(copyStatus("copy-1")).isEqualTo("ON_LOAN");

        // LIB-T04: return flips ISSUED → RETURNED + copy back to AVAILABLE.
        mvc.perform(post("/api/v1/library/staff/requests/" + requestId + "/return")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":3}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("RETURNED"))
                .andExpect(jsonPath("$.returnedBy").value("staff-1"));
        assertThat(copyStatus("copy-1")).isEqualTo("AVAILABLE");

        // Borrower notifications: approve + issue + return in same tx (§11).
        Integer notifications = jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications.notification WHERE user_id = 'borrower-1'",
                Integer.class);
        assertThat(notifications).isEqualTo(3);

        // Terminal: any further transition conflicts.
        mvc.perform(post("/api/v1/library/staff/requests/" + requestId + "/return")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":4}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("REQUEST_TERMINAL"));
        // Stock stays AVAILABLE — a second return never inflates it.
        assertThat(copyStatus("copy-1")).isEqualTo("AVAILABLE");
    }

    @Test
    void catalogueSearchTreatsLikeWildcardsLiterally() throws Exception {
        jdbc.update("INSERT INTO library.\"Title\" (\"id\", \"title\", \"author\", \"category\")"
                + " VALUES ('title-pct', '100% Solutions', 'Author P', 'CS')");
        jdbc.update("INSERT INTO library.\"Title\" (\"id\", \"title\", \"author\", \"category\")"
                + " VALUES ('title-und', 'Under_Score Book', 'Author U', 'CS')");

        // % and _ are literal characters in the stored titles, never wildcards.
        mvc.perform(get("/api/v1/library/catalogue").param("query", "%").with(borrowerJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value("title-pct"));
        mvc.perform(get("/api/v1/library/catalogue").param("query", "_").with(borrowerJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value("title-und"));
        mvc.perform(get("/api/v1/library/catalogue").param("query", "demo").with(borrowerJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));
        // Paging still applies to the filtered set.
        mvc.perform(get("/api/v1/library/catalogue")
                        .param("query", "demo").param("page", "0").param("limit", "1")
                        .with(borrowerJwt))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Total-Count", "2"))
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    void oneActiveRequestPerCopyAndPerBorrower() throws Exception {
        requestCopy(borrowerJwt, "copy-3", "lc-race-1");

        // Second patron cannot hold the same RESERVED copy.
        mvc.perform(post("/api/v1/library/requests")
                        .with(borrower2Jwt).header("Idempotency-Key", "lc-race-2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"copyId\":\"copy-3\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("COPY_UNAVAILABLE"));

        // Same borrower cannot double-hold the copy either.
        mvc.perform(post("/api/v1/library/requests")
                        .with(borrowerJwt).header("Idempotency-Key", "lc-race-3")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"copyId\":\"copy-3\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("COPY_UNAVAILABLE"));
    }

    @Test
    void patronIsolationIsIndistinguishableNotFound() throws Exception {
        String requestId = requestCopy(borrowerJwt, "copy-1", "lc-iso-1");

        // Foreign id answers the same REQUEST_NOT_FOUND as a missing id.
        mvc.perform(get("/api/v1/library/requests/" + requestId).with(borrower2Jwt))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("REQUEST_NOT_FOUND"));
        mvc.perform(get("/api/v1/library/requests/no-such-request").with(borrower2Jwt))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("REQUEST_NOT_FOUND"));

        // my-loans only lists own rows.
        mvc.perform(get("/api/v1/library/requests/my").with(borrower2Jwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));

        // Foreign cancel is indistinguishable too.
        mvc.perform(post("/api/v1/library/requests/" + requestId + "/cancel")
                        .with(borrower2Jwt).header("Idempotency-Key", "lc-iso-2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void scopedGrantIsTheOnlyStaffAuthority() throws Exception {
        // ADMIN role alone is not domain authority.
        mvc.perform(get("/api/v1/library/staff/requests").with(adminJwt))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("LIBRARY_STAFF_REQUIRED"));

        // Students cannot mutate inventory.
        mvc.perform(post("/api/v1/library/staff/titles")
                        .with(outsiderJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Forbidden\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("LIBRARY_STAFF_REQUIRED"));
        mvc.perform(post("/api/v1/library/staff/copies")
                        .with(outsiderJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"titleId\":\"title-1\",\"barcode\":\"BC-999\"}"))
                .andExpect(status().isForbidden());

        // A grant-holder without the ADMIN role cannot administer grants —
        // STAFF:library authorizes the desk, not the grant surface.
        mvc.perform(post("/api/v1/library/staff/grants")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\":\"student-9\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("LIBRARY_ADMIN_REQUIRED"));
        mvc.perform(delete("/api/v1/library/staff/grants/g-1").with(staffJwt))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("LIBRARY_ADMIN_REQUIRED"));

        // ADMIN grants itself the scope — the lanes open (and audit records it).
        mvc.perform(post("/api/v1/library/staff/grants")
                        .with(adminJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\":\"admin-user\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.scope").value("library"));
        mvc.perform(get("/api/v1/library/staff/requests").with(adminJwt))
                .andExpect(status().isOk());
        Integer grantAudit = jdbc.queryForObject(
                "SELECT COUNT(*) FROM library.\"Audit\" WHERE \"action\" = 'STAFF_GRANTED'",
                Integer.class);
        assertThat(grantAudit).isGreaterThanOrEqualTo(1);

        // Inventory writes need the grant; barcode uniqueness conflicts.
        mvc.perform(post("/api/v1/library/staff/copies")
                        .with(adminJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"titleId\":\"title-1\",\"barcode\":\"BC-001\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("BARCODE_TAKEN"));
    }

    @Test
    void inventoryWritesBoundPersistedStringsBeforeTheDatabase() throws Exception {
        mvc.perform(post("/api/v1/library/staff/titles").with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(titleBody("t".repeat(301), "Author", "isbn", "CS", "Publisher")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.fields.title").value("title must be at most 300 characters"));
        mvc.perform(post("/api/v1/library/staff/titles").with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(titleBody("Title", "a".repeat(301), "isbn", "CS", "Publisher")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.fields.author").value("author must be at most 300 characters"));
        mvc.perform(post("/api/v1/library/staff/titles").with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(titleBody("Title", "Author", "i".repeat(41), "CS", "Publisher")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fields.isbn").value("isbn must be at most 40 characters"));
        mvc.perform(post("/api/v1/library/staff/titles").with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(titleBody("Title", "Author", "isbn", "c".repeat(121), "Publisher")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fields.category").value("category must be at most 120 characters"));
        mvc.perform(post("/api/v1/library/staff/titles").with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(titleBody("Title", "Author", "isbn", "CS", "p".repeat(201))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fields.publisher").value("publisher must be at most 200 characters"));

        mvc.perform(post("/api/v1/library/staff/copies").with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"titleId\":\"title-1\",\"barcode\":\"" + "b".repeat(81) + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fields.barcode").value("barcode must be at most 80 characters"));

        String requestId = requestCopy(borrowerJwt, "copy-3", "lib-bounds-patron-cancel");
        mvc.perform(post("/api/v1/library/requests/" + requestId + "/cancel")
                        .with(borrowerJwt).header("Idempotency-Key", "lib-bounds-patron-cancel-2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1,\"reason\":\"" + "r".repeat(301) + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fields.reason").value("reason must be at most 300 characters"));

        String staffRequestId = requestCopy(borrower2Jwt, "copy-1", "lib-bounds-staff-cancel");
        mvc.perform(post("/api/v1/library/staff/requests/" + staffRequestId + "/cancel")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1,\"reason\":\"" + "r".repeat(301) + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fields.reason").value("reason must be at most 300 characters"));

        mvc.perform(post("/api/v1/library/staff/titles").with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(titleBody("t".repeat(300), "a".repeat(300), "i".repeat(40),
                                "c".repeat(120), "p".repeat(200))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.title").value("t".repeat(300)));
        mvc.perform(post("/api/v1/library/staff/copies").with(staffJwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"titleId\":\"title-1\",\"barcode\":\"" + "b".repeat(80) + "\"}"))
                .andExpect(status().isCreated());
        mvc.perform(post("/api/v1/library/requests/" + requestId + "/cancel")
                        .with(borrowerJwt).header("Idempotency-Key", "lib-bounds-patron-cancel-3")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1,\"reason\":\"" + "r".repeat(300) + "\"}"))
                .andExpect(status().isOk());
    }

    private static String titleBody(String title, String author, String isbn, String category, String publisher) {
        return "{\"title\":\"" + title + "\",\"author\":\"" + author + "\",\"isbn\":\"" + isbn
                + "\",\"category\":\"" + category + "\",\"publisher\":\"" + publisher + "\"}";
    }

    @Test
    void grantsListShowsOnlyTheCallersOwnGrant() throws Exception {
        RequestPostProcessor secondStaff = CurrentAccountJwt.fixtureJwt(jdbc, "staff-2", "STUDENT");
        jdbc.update("INSERT INTO library.\"StaffGrant\" (\"id\", \"userId\", \"scope\", \"grantedBy\")"
                + " VALUES ('g-2', 'staff-2', 'library', 'admin-user-2')");

        // Foreign staff rows disappear; the caller keeps only its own grant.
        mvc.perform(get("/api/v1/library/staff/grants").with(staffJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value("g-1"))
                .andExpect(jsonPath("$[0].userId").value("staff-1"));
        mvc.perform(get("/api/v1/library/staff/grants").with(secondStaff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value("g-2"))
                .andExpect(jsonPath("$[0].userId").value("staff-2"))
                .andExpect(jsonPath("$[0].grantedBy").value("admin-user-2"));

        // The response stays a bare array and the grant gate stays a 403.
        mvc.perform(get("/api/v1/library/staff/grants").with(outsiderJwt))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("LIBRARY_STAFF_REQUIRED"));
        mvc.perform(get("/api/v1/library/staff/grants").with(adminJwt))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("LIBRARY_STAFF_REQUIRED"));
    }

    @Test
    void repeatedGrantReplaysStoredProvenance() throws Exception {
        RequestPostProcessor secondAdmin = CurrentAccountJwt.fixtureJwt(jdbc, "admin-user-2", "ADMIN");
        MvcResult first = mvc.perform(post("/api/v1/library/staff/grants")
                        .with(adminJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\":\"student-9\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        MvcResult repeat = mvc.perform(post("/api/v1/library/staff/grants")
                        .with(secondAdmin).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\":\"student-9\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode firstGrant = objectMapper.readTree(first.getResponse().getContentAsString());
        JsonNode repeatGrant = objectMapper.readTree(repeat.getResponse().getContentAsString());
        // A repeat replays the stored row — original grantor and grant
        // instant — never the repeating admin's identity or a fresh clock.
        assertThat(repeatGrant.get("id").asText()).isEqualTo(firstGrant.get("id").asText());
        assertThat(repeatGrant.get("grantedBy").asText()).isEqualTo("admin-user");
        assertThat(repeatGrant.get("createdAt").asText()).isEqualTo(firstGrant.get("createdAt").asText());
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM library.\"StaffGrant\" WHERE \"userId\" = 'student-9'",
                Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM library.\"Audit\" WHERE \"action\" = 'STAFF_GRANTED'"
                        + " AND \"detail\" LIKE '%student-9%'",
                Integer.class)).isEqualTo(1);
    }

    @Test
    void cancelFreesCopyBeforeIssueAndIssuedLoansCannotCancel() throws Exception {
        String requestId = requestCopy(borrowerJwt, "copy-1", "lc-cancel-1");
        assertThat(copyStatus("copy-1")).isEqualTo("RESERVED");

        // LIB-T05 owner cancel: REQUESTED → CANCELLED, copy freed.
        mvc.perform(post("/api/v1/library/requests/" + requestId + "/cancel")
                        .with(borrowerJwt).header("Idempotency-Key", "lc-cancel-2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1,\"reason\":\"changed my mind\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"))
                .andExpect(jsonPath("$.cancelReason").value("changed my mind"));
        assertThat(copyStatus("copy-1")).isEqualTo("AVAILABLE");

        // Staff cancel on an APPROVED hold also frees the copy.
        String request2 = requestCopy(borrowerJwt, "copy-1", "lc-cancel-3");
        mvc.perform(post("/api/v1/library/staff/requests/" + request2 + "/approve")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/library/staff/requests/" + request2 + "/cancel")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":2,\"reason\":\"desk override\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"))
                .andExpect(jsonPath("$.cancelReason").value("desk override"));
        assertThat(copyStatus("copy-1")).isEqualTo("AVAILABLE");

        // An ISSUED loan cannot be cancelled — it must be returned.
        String request3 = requestCopy(borrowerJwt, "copy-1", "lc-cancel-4");
        mvc.perform(post("/api/v1/library/staff/requests/" + request3 + "/approve")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/library/staff/requests/" + request3 + "/issue")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":2}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/library/requests/" + request3 + "/cancel")
                        .with(borrowerJwt).header("Idempotency-Key", "lc-cancel-5")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":3}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("REQUEST_STATE_INVALID"));
        mvc.perform(post("/api/v1/library/staff/requests/" + request3 + "/cancel")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":3}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("REQUEST_STATE_INVALID"));
        assertThat(copyStatus("copy-1")).isEqualTo("ON_LOAN");
    }

    @Test
    void serverClockExpiryReleasesHeldCopies() throws Exception {
        String requestId = requestCopy(borrowerJwt, "copy-1", "lc-exp-1");
        assertThat(copyStatus("copy-1")).isEqualTo("RESERVED");

        // Push the hold deadline into the past; patron reads remain read-only.
        jdbc.update("UPDATE library.\"LoanRequest\" SET \"expiresAt\" = TIMESTAMP '2000-01-01 00:00:00'"
                + " WHERE \"id\" = '" + requestId + "'");

        mvc.perform(get("/api/v1/library/requests/" + requestId).with(borrowerJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REQUESTED"))
                .andExpect(jsonPath("$.expiresAt").isNotEmpty())
                .andExpect(jsonPath("$.cancelledAt").doesNotExist())
                .andExpect(jsonPath("$.version").value(1));
        assertThat(copyStatus("copy-1")).isEqualTo("RESERVED");
        // The existing staff maintenance lane durably cancels and releases it.
        mvc.perform(get("/api/v1/library/staff/requests").with(staffJwt))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/library/requests/" + requestId).with(borrowerJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"))
                .andExpect(jsonPath("$.cancelReason").value("RESERVATION_EXPIRED"));
        assertThat(copyStatus("copy-1")).isEqualTo("AVAILABLE");

        // LIB-T02: an expired hold cannot be approved.
        String request2 = requestCopy(borrowerJwt, "copy-1", "lc-exp-2");
        jdbc.update("UPDATE library.\"LoanRequest\" SET \"expiresAt\" = TIMESTAMP '2000-01-01 00:00:00'"
                + " WHERE \"id\" = '" + request2 + "'");
        // Direct approval rejects the deadline without claiming cleanup committed.
        mvc.perform(post("/api/v1/library/staff/requests/" + request2 + "/approve")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RESERVATION_EXPIRED"));

        // An expired APPROVED hold can never be issued; issue checks the same window as approve,
        // so the denial is deterministic regardless of sweep timing.
        String request3 = requestCopy(borrowerJwt, "copy-1", "lc-exp-3");
        mvc.perform(post("/api/v1/library/staff/requests/" + request3 + "/approve")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1}"))
                .andExpect(status().isOk());
        jdbc.update("UPDATE library.\"LoanRequest\" SET \"expiresAt\" = TIMESTAMP '2000-01-01 00:00:00'"
                + " WHERE \"id\" = '" + request3 + "'");
        mvc.perform(post("/api/v1/library/staff/requests/" + request3 + "/issue")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":2}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RESERVATION_EXPIRED"));
        // Still APPROVED until a sweep lane materializes it — the deny
        // decision never depends on that timing.
        String status3 = jdbc.queryForObject(
                "SELECT \"status\" FROM library.\"LoanRequest\" WHERE \"id\" = '" + request3 + "'",
                String.class);
        assertThat(status3).isEqualTo("APPROVED");
        // The queue sweep cancels the dead hold and frees the stock.
        mvc.perform(get("/api/v1/library/staff/requests").with(staffJwt))
                .andExpect(status().isOk());
        assertThat(copyStatus("copy-1")).isEqualTo("AVAILABLE");
        status3 = jdbc.queryForObject(
                "SELECT \"status\" FROM library.\"LoanRequest\" WHERE \"id\" = '" + request3 + "'",
                String.class);
        assertThat(status3).isEqualTo("CANCELLED");

        // A dead hold no longer blocks its copy: the request lane expires only that copy before the flip, so a
        // fresh hold on the freed stock succeeds without any read path.
        String request4 = requestCopy(borrowerJwt, "copy-2", "lc-exp-4");
        jdbc.update("UPDATE library.\"LoanRequest\" SET \"expiresAt\" = TIMESTAMP '2000-01-01 00:00:00'"
                + " WHERE \"id\" = '" + request4 + "'");
        String request5 = requestCopy(borrower2Jwt, "copy-2", "lc-exp-5");
        assertThat(request5).isNotEmpty();
        String status4 = jdbc.queryForObject(
                "SELECT \"status\" FROM library.\"LoanRequest\" WHERE \"id\" = '" + request4 + "'",
                String.class);
        assertThat(status4).isEqualTo("CANCELLED");
    }

    @Test
    void idempotentRequestAndCancelReplay() throws Exception {
        // Missing key → 400.
        mvc.perform(post("/api/v1/library/requests")
                        .with(borrowerJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"copyId\":\"copy-2\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REQUIRED"));

        // Same-key replay returns the stored response — no second request row.
        String requestId = requestCopy(borrowerJwt, "copy-2", "lc-idem-1");
        MvcResult replay = mvc.perform(post("/api/v1/library/requests")
                        .with(borrowerJwt).header("Idempotency-Key", "lc-idem-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"copyId\":\"copy-2\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(requestId))
                .andReturn();
        assertThat(objectMapper.readTree(replay.getResponse().getContentAsString())
                .get("id").asText()).isEqualTo(requestId);
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM library.\"LoanRequest\" WHERE \"copyId\" = 'copy-2'",
                Integer.class);
        assertThat(count).isEqualTo(1);

        // Same key, different copy → conflict (hash binds the request body).
        mvc.perform(post("/api/v1/library/requests")
                        .with(borrowerJwt).header("Idempotency-Key", "lc-idem-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"copyId\":\"copy-1\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_CONFLICT"));

        // Cancel replay: same key + same version replays, new version conflicts.
        mvc.perform(post("/api/v1/library/requests/" + requestId + "/cancel")
                        .with(borrowerJwt).header("Idempotency-Key", "lc-idem-2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"));
        MvcResult explicitDefaultReasonReplay = mvc.perform(post("/api/v1/library/requests/"
                        + requestId + "/cancel")
                        .with(borrowerJwt).header("Idempotency-Key", "lc-idem-2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1,\"reason\":\"BORROWER_CANCELLED\"}"))
                .andReturn();
        assertThat(explicitDefaultReasonReplay.getResponse().getStatus()).isEqualTo(200);
        assertThat(objectMapper.readTree(explicitDefaultReasonReplay.getResponse().getContentAsString())
                .get("cancelReason").asText()).isEqualTo("BORROWER_CANCELLED");

        MvcResult changedReason = mvc.perform(post("/api/v1/library/requests/" + requestId + "/cancel")
                        .with(borrowerJwt).header("Idempotency-Key", "lc-idem-2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1,\"reason\":\"NO_LONGER_NEEDED\"}"))
                .andReturn();
        assertThat(changedReason.getResponse().getStatus()).isEqualTo(409);
        assertThat(objectMapper.readTree(changedReason.getResponse().getContentAsString())
                .get("code").asText()).isEqualTo("IDEMPOTENCY_CONFLICT");
        assertThat(jdbc.queryForObject(
                "SELECT \"version\" FROM library.\"LoanRequest\" WHERE \"id\" = ?",
                Integer.class, requestId)).isEqualTo(2);
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM library.\"Audit\" WHERE \"entityType\" = 'REQUEST'"
                        + " AND \"entityId\" = ? AND \"action\" = 'CANCELLED'",
                Integer.class, requestId)).isEqualTo(1);
        mvc.perform(post("/api/v1/library/requests/" + requestId + "/cancel")
                        .with(borrowerJwt).header("Idempotency-Key", "lc-idem-2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"));
        mvc.perform(post("/api/v1/library/requests/" + requestId + "/cancel")
                        .with(borrowerJwt).header("Idempotency-Key", "lc-idem-2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":2}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_CONFLICT"));
    }

    @Test
    void optimisticVersionAndStateGuards() throws Exception {
        String requestId = requestCopy(borrowerJwt, "copy-1", "lc-ver-1");

        // Missing version → 400; stale version → 409.
        mvc.perform(post("/api/v1/library/staff/requests/" + requestId + "/approve")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("REQUEST_VERSION_REQUIRED"));
        mvc.perform(post("/api/v1/library/staff/requests/" + requestId + "/approve")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":9}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STALE_VERSION"));

        // Skipping the machine: issue before approve → 409.
        mvc.perform(post("/api/v1/library/staff/requests/" + requestId + "/issue")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("REQUEST_STATE_INVALID"));
    }

    @Test
    void softRetireKeepsLoanHistoryAndBlocksActiveCopies() throws Exception {
        // Copy with an active request cannot retire.
        String requestId = requestCopy(borrowerJwt, "copy-1", "lc-ret-1");
        mvc.perform(post("/api/v1/library/staff/copies/copy-1/retire")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":2}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("COPY_HAS_ACTIVE_LOAN"));

        // Complete the loan, then retire — history rows survive (LIB-T06).
        mvc.perform(post("/api/v1/library/staff/requests/" + requestId + "/approve")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/library/staff/requests/" + requestId + "/issue")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":2}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/library/staff/requests/" + requestId + "/return")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":3}"))
                .andExpect(status().isOk());
        int copyVersion = jdbc.queryForObject(
                "SELECT \"version\" FROM library.\"Copy\" WHERE \"id\" = 'copy-1'",
                Integer.class);
        mvc.perform(post("/api/v1/library/staff/copies/copy-1/retire")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":" + copyVersion + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("RETIRED"));
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM library.\"LoanRequest\" WHERE \"copyId\" = 'copy-1'"
                        + " AND \"status\" = 'RETURNED'", Integer.class)).isEqualTo(1);

        // A retired copy cannot be requested; double-retire conflicts.
        mvc.perform(post("/api/v1/library/requests")
                        .with(borrower2Jwt).header("Idempotency-Key", "lc-ret-2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"copyId\":\"copy-1\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("COPY_TERMINAL"));
        mvc.perform(post("/api/v1/library/staff/copies/copy-1/retire")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":" + (copyVersion + 1) + "}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("COPY_TERMINAL"));
    }

    @Test
    void inactiveUserCannotRequest() throws Exception {
        // The request-time account guard rejects suspended sessions before
        // the service lane (defense in depth: requireActiveUser backs it up).
        mvc.perform(post("/api/v1/library/requests")
                        .with(inactiveJwt).header("Idempotency-Key", "lc-inactive-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"copyId\":\"copy-1\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCOUNT_INACTIVE"));
        assertThat(copyStatus("copy-1")).isEqualTo("AVAILABLE");
    }

    @Test
    void notificationsReachTheBorrowerOnStaffActions() throws Exception {
        String requestId = requestCopy(borrowerJwt, "copy-1", "lc-note-1");
        mvc.perform(post("/api/v1/library/staff/requests/" + requestId + "/approve")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/library/staff/requests/" + requestId + "/cancel")
                        .with(staffJwt).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":2,\"reason\":\"desk override\"}"))
                .andExpect(status().isOk());
        var rows = jdbc.queryForList(
                "SELECT \"title\", \"link\" FROM notifications.notification"
                        + " WHERE user_id = 'borrower-1' ORDER BY created_at");
        assertThat(rows).hasSize(2);
        assertThat(String.valueOf(rows.get(0).get("title"))).contains("duyệt");
        assertThat(String.valueOf(rows.get(0).get("link"))).isEqualTo("/library");
        // Staff actions never notify the borrower2 / outsider accounts.
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM notifications.notification WHERE user_id <> 'borrower-1'",
                Integer.class)).isEqualTo(0);
    }
}
