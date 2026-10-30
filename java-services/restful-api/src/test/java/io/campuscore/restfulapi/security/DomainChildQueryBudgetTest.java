package io.campuscore.restfulapi.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.when;

import io.campuscore.restfulapi.admissions.service.AdmissionApplicantService;
import io.campuscore.restfulapi.admissions.service.AdmissionService;
import io.campuscore.restfulapi.careers.service.CareerService;
import io.campuscore.restfulapi.notification.repository.NotificationWriteRepository;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.invocation.InvocationOnMock;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.jdbc.core.ConnectionCallback;

class DomainChildQueryBudgetTest {

    @Test
    void admissionChildQueryCountDoesNotGrowWithParentCount() {
        assertThat(admissionQueryCount(100)).isEqualTo(admissionQueryCount(1));
    }

    @Test
    void careerChildQueryCountDoesNotGrowWithParentCount() throws Exception {
        assertThat(careerQueryCount(100)).isEqualTo(careerQueryCount(1));
    }

    private long admissionQueryCount(int parentCount) {
        List<Map<String, Object>> parents = admissionRows(parentCount);
        NamedParameterJdbcTemplate jdbc = jdbc(parents, false);
        AdmissionService staff = new AdmissionService(jdbc,
                mock(NotificationWriteRepository.class), mock(tools.jackson.databind.ObjectMapper.class));
        AdmissionApplicantService applicant = new AdmissionApplicantService(jdbc, staff,
                mock(tools.jackson.databind.ObjectMapper.class));

        applicant.myApplications("owner-a");

        return sqlCallCount(jdbc);
    }

    private long careerQueryCount(int parentCount) throws Exception {
        NamedParameterJdbcTemplate jdbc = jdbc(List.of(), true);
        stubCareerQueries(jdbc, parentCount);
        CareerService careers = new CareerService(jdbc, mock(NotificationWriteRepository.class));

        careers.applicationQueue("recruiter-a", null, null);

        return sqlCallCount(jdbc);
    }

    private static NamedParameterJdbcTemplate jdbc(List<Map<String, Object>> admissionParents,
            boolean career) {
        NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
        JdbcOperations operations = mock(JdbcOperations.class);
        when(jdbc.getJdbcOperations()).thenReturn(operations);
        when(operations.execute(org.mockito.ArgumentMatchers.<ConnectionCallback<Boolean>>any()))
                .thenReturn(false);
        if (!career) {
            doAnswer(invocation -> {
                String sql = invocation.getArgument(0);
                if (sql.contains("FROM admissions.\"Application\"")) {
                    return admissionParents;
                }
                return List.of();
            }).when(jdbc).query(anyString(), any(SqlParameterSource.class), any(RowMapper.class));
        }
        return jdbc;
    }

    private static void stubCareerQueries(NamedParameterJdbcTemplate jdbc, int parentCount)
            throws Exception {
        List<ResultSet> parents = new ArrayList<>();
        for (int i = 0; i < parentCount; i++) {
            parents.add(careerRow("application-" + i));
        }
        doAnswer(invocation -> {
            String sql = invocation.getArgument(0);
            if (sql.contains("FROM careers.\"StaffGrant\"")) {
                return List.of("org-alpha");
            }
            if (sql.contains("FROM careers.\"Application\" a")) {
                RowMapper<?> mapper = invocation.getArgument(2);
                List<Object> mapped = new ArrayList<>();
                for (int i = 0; i < parents.size(); i++) {
                    mapped.add(mapper.mapRow(parents.get(i), i));
                }
                return mapped;
            }
            return List.of();
        }).when(jdbc).query(anyString(), any(SqlParameterSource.class), any(RowMapper.class));
        doAnswer(invocation -> {
            Class<?> resultType = invocation.getArgument(2);
            if (Integer.class.equals(resultType)) {
                return 1;
            }
            if (Long.class.equals(resultType)) {
                return (long) parentCount;
            }
            return null;
        }).when(jdbc).queryForObject(anyString(), any(SqlParameterSource.class), any(Class.class));
    }

    private static ResultSet careerRow(String applicationId) throws Exception {
        String[] columns = {
                "id", "opportunityId", "opp_title", "organizationId", "org_name",
                "candidateUserId", "candidate_email", "status", "coverLetter",
                "submittedAt", "statusChangedBy", "statusChangedAt",
                "moderationReason", "version", "createdAt"};
        Object[] values = {
                applicationId, "opportunity-a", "Demo opportunity", "org-alpha", "Alpha Demo",
                "candidate-a", "candidate@example.test", "SUBMITTED", null,
                null, null, null,
                null, 1, null};
        java.sql.ResultSetMetaData meta = mock(java.sql.ResultSetMetaData.class);
        when(meta.getColumnCount()).thenReturn(columns.length);
        for (int i = 0; i < columns.length; i++) {
            when(meta.getColumnLabel(i + 1)).thenReturn(columns[i]);
        }
        ResultSet row = mock(ResultSet.class);
        when(row.getMetaData()).thenReturn(meta);
        for (int i = 0; i < values.length; i++) {
            when(row.getObject(i + 1)).thenReturn(values[i]);
        }
        return row;
    }

    private static List<Map<String, Object>> admissionRows(int count) {
        List<Map<String, Object>> rows = new ArrayList<>();
        Timestamp created = Timestamp.valueOf("2026-01-01 00:00:00");
        for (int i = 0; i < count; i++) {
            Map<String, Object> row = new HashMap<>();
            row.put("id", "application-" + i);
            row.put("applicantUserId", "owner-a");
            row.put("cycle", "2026-Q1");
            row.put("status", "SUBMITTED");
            row.put("version", 1);
            row.put("createdAt", created);
            row.put("updatedAt", created);
            rows.add(row);
        }
        return rows;
    }

    private static long sqlCallCount(NamedParameterJdbcTemplate jdbc) {
        return mockingDetails(jdbc).getInvocations().stream()
                .filter(invocation -> isSqlCall(invocation))
                .count();
    }

    private static boolean isSqlCall(InvocationOnMock invocation) {
        String method = invocation.getMethod().getName();
        return "query".equals(method) || "queryForObject".equals(method);
    }
}
