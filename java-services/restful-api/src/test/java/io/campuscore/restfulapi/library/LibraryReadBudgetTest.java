package io.campuscore.restfulapi.library;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.spy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;

import io.campuscore.restfulapi.library.service.LibraryPatronService;
import io.campuscore.restfulapi.library.service.LibraryService;
import io.campuscore.restfulapi.library.web.LibraryDtos.BorrowRequest;
import io.campuscore.restfulapi.library.web.LibraryDtos.IssueRequest;
import io.campuscore.restfulapi.library.web.LibraryPatronController;
import io.campuscore.restfulapi.notification.repository.NotificationWriteRepository;
import io.campuscore.restfulapi.web.DomainException;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.jdbc.datasource.DelegatingDataSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import tools.jackson.databind.ObjectMapper;
import org.springframework.security.oauth2.jwt.Jwt;

class LibraryReadBudgetTest {
    private JdbcTemplate jdbc;
    private LibraryService staff;
    private LibraryPatronService patron;
    private NamedParameterJdbcTemplate named;
    private final List<String> statements = new ArrayList<>();
    private final Map<String, Integer> rowsRead = new HashMap<>();

    @BeforeEach
    void fixture() throws Exception {
        var source = new DriverManagerDataSource("jdbc:h2:mem:library_budget_"
                + UUID.randomUUID() + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1", "sa", "");
        var measured = new DelegatingDataSource(source) {
            @Override
            public Connection getConnection() throws java.sql.SQLException {
                Connection connection = super.getConnection();
                return (Connection) Proxy.newProxyInstance(getClass().getClassLoader(),
                        new Class<?>[]{Connection.class}, (proxy, method, args) -> {
                            Object result = invoke(connection, method, args);
                            if (method.getName().equals("prepareStatement")) {
                                String sql = (String) args[0];
                                return Proxy.newProxyInstance(getClass().getClassLoader(),
                                        new Class<?>[]{PreparedStatement.class}, (p, m, a) -> {
                                            if (m.getName().startsWith("execute")) {
                                                statements.add(sql);
                                            }
                                            Object value = invoke(result, m, a);
                                            if (value instanceof ResultSet rows) {
                                                return Proxy.newProxyInstance(getClass().getClassLoader(),
                                                        new Class<?>[]{ResultSet.class}, (rp, rm, ra) -> {
                                                            Object next = invoke(rows, rm, ra);
                                                            if (rm.getName().equals("next") && Boolean.TRUE.equals(next)) {
                                                                rowsRead.merge(sql, 1, Integer::sum);
                                                            }
                                                            return next;
                                                        });
                                            }
                                            return value;
                                        });
                            }
                            return result;
                        });
            }
        };
        jdbc = new JdbcTemplate(measured);
        jdbc.execute("CREATE SCHEMA campuscore_auth");
        jdbc.execute("CREATE TABLE campuscore_auth.\"User\" (\"id\" VARCHAR PRIMARY KEY,"
                + " \"email\" VARCHAR, \"status\" VARCHAR)");
        jdbc.update("INSERT INTO campuscore_auth.\"User\" VALUES"
                + " ('reader','reader@test.local','ACTIVE'), ('owner','owner@test.local','ACTIVE')");
        try (Connection connection = measured.getConnection()) {
            ScriptUtils.executeSqlScript(connection,
                    new ClassPathResource("db/migration-h2/V141__library_schema.sql"));
        }
        jdbc.update("INSERT INTO library.\"StaffGrant\" (\"id\",\"userId\",\"scope\",\"grantedBy\")"
                + " VALUES ('grant','desk','library','admin')");
        named = spy(new NamedParameterJdbcTemplate(measured));
        staff = new LibraryService(named, mock(NotificationWriteRepository.class), 48, 14);
        patron = new LibraryPatronService(named, staff, new ObjectMapper());
        titleAndCopy(1);
        expiredHold(1, "REQUESTED");
        statements.clear();
    }

    @Test
    void patronReadsDoNotWriteUnrelatedExpiryOrAudit() {
        patron.catalogue("reader", null);
        patron.title("reader", "title-1");
        assertThat(patron.myLoans("reader")).isEmpty();
        assertThatThrownBy(() -> patron.myLoan("reader", "hold-1"))
                .isInstanceOf(DomainException.class);
        assertThat(statements).noneMatch(sql -> !sql.startsWith("SELECT"));
        assertThat(status("hold-1")).isEqualTo("REQUESTED");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM library.\"Audit\"", Integer.class)).isZero();
    }

    @Test
    void expiredPresentationRetainsDeadlineAndReservedCopyUntilDurableCleanup() {
        var hold = patron.myLoan("owner", "hold-1");
        assertThat(hold.status()).isEqualTo("REQUESTED");
        assertThat(hold.expiresAt()).isBefore(java.time.Instant.now());
        assertThat(hold.cancelledAt()).isNull();
        assertThat(hold.version()).isEqualTo(1);
        var title = patron.title("reader", "title-1");
        assertThat(title.availableCopies()).isZero();
        assertThat(title.copies().getFirst().status()).isEqualTo("RESERVED");
    }

    @Test
    void catalogueBatchesCopiesIndependentlyOfTitleCount() {
        assertThat(patron.catalogue("reader", null)).hasSize(1);
        assertThat(statements).hasSize(2);
        for (int i = 2; i <= 100; i++) {
            titleAndCopy(i);
        }
        statements.clear();
        assertThat(patron.catalogue("reader", null)).hasSize(100);
        assertThat(statements).hasSize(2);
        titleAndCopy(101);
        statements.clear();
        assertThat(patron.catalogue("reader", null)).hasSize(101);
        assertThat(statements).hasSize(3);
        statements.clear();
        assertThat(patron.catalogue("reader", "not-present")).isEmpty();
        assertThat(statements).hasSize(1);
    }

    @Test
    void newRequestExpiresOnlyItsCopyWithoutAttributingExpiryToRequester() {
        titleAndCopy(2);
        expiredHold(2, "REQUESTED");
        var request = patron.request("reader", new BorrowRequest("copy-1"), "new-hold");
        assertThat(request.status()).isEqualTo("REQUESTED");
        assertThat(status("hold-1")).isEqualTo("CANCELLED");
        assertThat(status("hold-2")).isEqualTo("REQUESTED");
        assertThat(jdbc.queryForObject("SELECT \"actorId\" FROM library.\"Audit\""
                + " WHERE \"action\" = 'EXPIRED' AND \"entityId\" = 'hold-1'", String.class))
                .isNotEqualTo("reader");
    }

    @Test
    void staffExpiryProcessesAtMostOneHundredHoldsPerTransaction() {
        for (int i = 2; i <= 103; i++) {
            titleAndCopy(i);
            expiredHold(i, "REQUESTED");
        }
        assertThat(staff.expireOverdue("desk")).isEqualTo(100);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM library.\"LoanRequest\""
                + " WHERE \"status\" = 'REQUESTED'", Integer.class)).isEqualTo(3);
        assertThat(staff.expireOverdue("desk")).isEqualTo(3);
        assertThat(staff.expireOverdue("desk")).isZero();
    }

    @Test
    void patronCannotInvokeGlobalExpiryMaintenance() {
        assertThatThrownBy(() -> staff.expireOverdue("reader")).isInstanceOf(DomainException.class);
        assertThat(statements).allMatch(sql -> sql.startsWith("SELECT"));
        assertThat(status("hold-1")).isEqualTo("REQUESTED");
    }

    @Test
    void expiredApprovalAndIssueDoNotClaimThatReservedCopyWasReleased() {
        assertThatThrownBy(() -> staff.approve("desk", "hold-1", 1))
                .isInstanceOf(DomainException.class).hasMessageNotContaining("released");
        jdbc.update("UPDATE library.\"LoanRequest\" SET \"status\" = 'APPROVED' WHERE \"id\" = 'hold-1'");
        assertThatThrownBy(() -> staff.issue("desk", "hold-1", new IssueRequest(1, 14)))
                .isInstanceOf(DomainException.class).hasMessageNotContaining("released");
        assertThat(status("hold-1")).isEqualTo("APPROVED");
        assertThat(jdbc.queryForObject("SELECT \"status\" FROM library.\"Copy\""
                + " WHERE \"id\" = 'copy-1'", String.class)).isEqualTo("RESERVED");
    }

    @Test
    void cataloguePagesAreBoundInSqlBeforeCopiesAreHydrated() {
        for (int i = 2; i <= 5; i++) {
            titleAndCopy(i);
        }
        jdbc.update("UPDATE library.\"Title\" SET \"title\" = 'Same title'");
        statements.clear();
        rowsRead.clear();
        var controller = new LibraryPatronController(patron);
        var jwt = Jwt.withTokenValue("fixture").header("alg", "none").subject("reader").build();
        var page = controller.catalogue(jwt, "same", 1, 2);
        assertThat(page.getHeaders().getFirst("X-Total-Count")).isEqualTo("5");
        assertThat(page.getBody()).extracting(title -> title.id()).containsExactly("title-3", "title-4");
        assertThat(statements).hasSize(3);
        assertThat(rowsRead.entrySet().stream().filter(entry -> entry.getKey().contains("FROM library.\"Copy\""))
                .mapToInt(Map.Entry::getValue).sum()).isEqualTo(2);
        assertThat(rowsRead.entrySet().stream().filter(entry -> entry.getKey().startsWith("SELECT \"id\", \"title\""))
                .mapToInt(Map.Entry::getValue).sum()).isEqualTo(2);
        statements.clear();
        var empty = controller.catalogue(jwt, "same", Integer.MAX_VALUE, 100);
        assertThat(empty.getBody()).isEmpty();
        assertThat(empty.getHeaders().getFirst("X-Total-Count")).isEqualTo("5");
        assertThat(statements).hasSize(2);
        statements.clear();
        assertThatThrownBy(() -> controller.catalogue(jwt, null, -1, 2)).isInstanceOf(DomainException.class);
        assertThat(statements).isEmpty();
    }

    @Test
    void issueRechecksDeadlineAfterWaitingForTheCopyLock() {
        var deadline = java.time.Instant.now().plusSeconds(2);
        jdbc.update("UPDATE library.\"LoanRequest\" SET \"status\" = 'APPROVED', \"expiresAt\" = ?"
                + " WHERE \"id\" = 'hold-1'", java.sql.Timestamp.from(deadline));
        doAnswer(invocation -> {
            Object result = invocation.callRealMethod();
            String sql = invocation.getArgument(0);
            if (sql.contains("FROM library.\"Copy\"") && sql.endsWith("FOR UPDATE")) {
                assertThat(java.time.Instant.now()).isBefore(deadline);
                while (!java.time.Instant.now().isAfter(deadline)) {
                    Thread.sleep(5);
                }
            }
            return result;
        }).when(named).queryForMap(anyString(), any(SqlParameterSource.class));
        assertThatThrownBy(() -> staff.issue("desk", "hold-1", new IssueRequest(1, 14)))
                .isInstanceOf(DomainException.class).hasMessageContaining("expired");
        assertThat(status("hold-1")).isEqualTo("APPROVED");
    }

    private void titleAndCopy(int i) {
        jdbc.update("INSERT INTO library.\"Title\" (\"id\",\"title\",\"category\") VALUES (?, ?, 'CS')",
                "title-" + i, "Title " + i);
        jdbc.update("INSERT INTO library.\"Copy\" (\"id\",\"titleId\",\"barcode\") VALUES (?, ?, ?)",
                "copy-" + i, "title-" + i, "barcode-" + i);
    }

    private void expiredHold(int i, String state) {
        jdbc.update("UPDATE library.\"Copy\" SET \"status\" = 'RESERVED' WHERE \"id\" = ?", "copy-" + i);
        jdbc.update("INSERT INTO library.\"LoanRequest\""
                + " (\"id\",\"copyId\",\"borrowerUserId\",\"status\",\"expiresAt\")"
                + " VALUES (?, ?, 'owner', ?, TIMESTAMP '2000-01-01 00:00:00')", "hold-" + i, "copy-" + i, state);
    }

    private String status(String id) {
        return jdbc.queryForObject("SELECT \"status\" FROM library.\"LoanRequest\" WHERE \"id\" = ?",
                String.class, id);
    }

    private static Object invoke(Object target, java.lang.reflect.Method method, Object[] args) throws Throwable {
        try {
            return method.invoke(target, args);
        } catch (InvocationTargetException exception) {
            throw exception.getCause();
        }
    }
}
