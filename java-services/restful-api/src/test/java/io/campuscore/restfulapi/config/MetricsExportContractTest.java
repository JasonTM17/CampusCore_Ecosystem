package io.campuscore.restfulapi.config;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.micrometer.core.instrument.MeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = "management.metrics.scrape-key=fixture-scrape-key")
@ActiveProfiles({"test", "persistence"})
@AutoConfigureMockMvc
class MetricsExportContractTest {
    @Autowired MockMvc mvc;
    @Autowired MeterRegistry registry;

    @Test
    void configuredInternalScrapeExportsBoundedZeroSeriesAndHttpHistogram() throws Exception {
        mvc.perform(get("/api/v1/health/liveness")).andExpect(status().isOk());
        String scrape = mvc.perform(get("/actuator/prometheus")
                        .header("X-Metrics-Key", "fixture-scrape-key"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertTrue(scrape.contains("http_server_requests_seconds_bucket"));
        for (String meter : java.util.List.of("active", "max", "pending", "timeout_total")) {
            assertTrue(scrape.contains("hikaricp_connections_" + meter), meter);
        }
        assertTrue(scrape.contains("campuscore_assistant_requests_total{degraded=\"true\"} 0.0"));
        assertTrue(scrape.contains("campuscore_assistant_requests_total{degraded=\"false\"} 0.0"));
        assertTrue(scrape.contains("campuscore_assistant_rls_verified 0.0"),
                "a missing verifier must never be exported as verified");
        assertFalse(scrape.contains("reason_code="));
    }

    @Test
    void fixedSecurityRoutesRetainTheirUriWhileRawPathsAndObservationUrlsStayOutOfTags() throws Exception {
        var convention = new MetricsConfiguration().boundedHttpObservationConvention();
        for (String path : java.util.List.of("/api/v1/auth/login", "/oauth2/token")) {
            var request = new org.springframework.mock.web.MockHttpServletRequest("POST", path);
            var response = new org.springframework.mock.web.MockHttpServletResponse();
            response.setStatus(429);
            var observation = new org.springframework.http.server.observation.ServerRequestObservationContext(request, response);
            assertEquals(path, convention.getLowCardinalityKeyValues(observation).stream()
                    .filter(tag -> tag.getKey().equals("uri")).findFirst().orElseThrow().getValue());
            assertFalse(convention.getHighCardinalityKeyValues(observation).iterator().hasNext());
        }
        mvc.perform(get("/unknown/sentinel-person-123456"));
        String scrape = mvc.perform(get("/actuator/prometheus").header("X-Metrics-Key", "fixture-scrape-key"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertFalse(scrape.contains("sentinel-person"));
    }

    @Test
    void routeBudgetRejectsAdditionalSeriesAndUnknownRlsNeverMeansVerified() {
        var isolated = new io.micrometer.core.instrument.simple.SimpleMeterRegistry();
        try {
            isolated.config().meterFilter(new MetricsConfiguration().boundedHttpRoutes());
            for (int index = 0; index < 1025; index++) {
                isolated.timer("http.server.requests", "uri", "/template-" + index).record(java.time.Duration.ofMillis(5));
            }
            assertEquals(1024, isolated.find("http.server.requests").timers().size());
            var state = new io.campuscore.restfulapi.thesis.assistant.AssistantRlsState();
            var beans = new org.springframework.beans.factory.support.StaticListableBeanFactory();
            beans.addBean("rls", state);
            new MetricsConfiguration().assistantMeters(beans.getBeanProvider(
                    io.campuscore.restfulapi.thesis.assistant.AssistantRlsState.class),
                    beans.getBeanProvider(javax.sql.DataSource.class)).bindTo(isolated);
            assertEquals(0, isolated.get("campuscore.assistant.rls.verified").gauge().value());
            state.markVerified("fixture");
            assertEquals(1, isolated.get("campuscore.assistant.rls.verified").gauge().value());
            state.markDegraded("fixture");
            assertEquals(0, isolated.get("campuscore.assistant.rls.verified").gauge().value());
            assertTrue(Double.isNaN(isolated.get("campuscore.assistant.quota.consumed.daily").gauge().value()));
        } finally { isolated.close(); }
    }

    @Test
    void verifiedQuotaReadUsesOnlyGlobalPolicyAndClearsContextOnSuccessAndFailure() throws Exception {
        var source = org.mockito.Mockito.mock(javax.sql.DataSource.class);
        var connection = org.mockito.Mockito.mock(java.sql.Connection.class);
        var metadata = org.mockito.Mockito.mock(java.sql.DatabaseMetaData.class);
        var statement = org.mockito.Mockito.mock(java.sql.PreparedStatement.class);
        var result = org.mockito.Mockito.mock(java.sql.ResultSet.class);
        org.mockito.Mockito.when(source.getConnection()).thenReturn(connection);
        org.mockito.Mockito.when(connection.getMetaData()).thenReturn(metadata);
        org.mockito.Mockito.when(metadata.getDatabaseProductName()).thenReturn("PostgreSQL");
        org.mockito.Mockito.when(connection.prepareStatement(org.mockito.ArgumentMatchers.anyString())).thenReturn(statement);
        org.mockito.Mockito.when(statement.executeQuery()).thenReturn(result);
        org.mockito.Mockito.when(result.next()).thenReturn(true);
        org.mockito.Mockito.when(result.getInt(1)).thenReturn(7);
        var beans = new org.springframework.beans.factory.support.StaticListableBeanFactory();
        beans.addBean("assistant", source);
        var state = new io.campuscore.restfulapi.thesis.assistant.AssistantRlsState();
        state.markVerified("fixture");
        beans.addBean("rls", state);
        var isolated = new io.micrometer.core.instrument.simple.SimpleMeterRegistry();
        try {
            new MetricsConfiguration().assistantMeters(beans.getBeanProvider(
                    io.campuscore.restfulapi.thesis.assistant.AssistantRlsState.class),
                    beans.getBeanProvider(javax.sql.DataSource.class)).bindTo(isolated);
            var quota = isolated.get("campuscore.assistant.quota.consumed.daily").gauge();
            assertEquals(7, quota.value());
            org.mockito.Mockito.verify(connection).setReadOnly(true);
            org.mockito.Mockito.verify(connection).setAutoCommit(false);
            org.mockito.Mockito.verify(connection).prepareStatement(org.mockito.ArgumentMatchers.contains("owner_id='*' AND scope='GLOBAL'"));
            org.mockito.Mockito.verify(connection).prepareStatement(org.mockito.ArgumentMatchers.contains("set_config('app.assistant.owner_id','',true)"));
            org.mockito.Mockito.verify(connection).rollback();
            org.mockito.Mockito.when(statement.executeQuery()).thenThrow(new java.sql.SQLException("fixture"));
            assertTrue(Double.isNaN(quota.value()));
            org.mockito.Mockito.verify(connection, org.mockito.Mockito.times(2)).rollback();
        } finally { isolated.close(); }
    }

    @Test
    void unverifiedQuotaSourceIsUnknownInsteadOfReportingAnEmptyBucket() throws Exception {
        var source = org.mockito.Mockito.mock(javax.sql.DataSource.class);
        var connection = org.mockito.Mockito.mock(java.sql.Connection.class);
        var metadata = org.mockito.Mockito.mock(java.sql.DatabaseMetaData.class);
        var statement = org.mockito.Mockito.mock(java.sql.PreparedStatement.class);
        var result = org.mockito.Mockito.mock(java.sql.ResultSet.class);
        org.mockito.Mockito.when(source.getConnection()).thenReturn(connection);
        org.mockito.Mockito.when(connection.getMetaData()).thenReturn(metadata);
        org.mockito.Mockito.when(metadata.getDatabaseProductName()).thenReturn("PostgreSQL");
        org.mockito.Mockito.when(connection.prepareStatement(org.mockito.ArgumentMatchers.anyString())).thenReturn(statement);
        org.mockito.Mockito.when(statement.executeQuery()).thenReturn(result);
        org.mockito.Mockito.when(result.next()).thenReturn(true);
        org.mockito.Mockito.when(result.wasNull()).thenReturn(true);
        var beans = new org.springframework.beans.factory.support.StaticListableBeanFactory();
        beans.addBean("primary", source);
        var isolated = new io.micrometer.core.instrument.simple.SimpleMeterRegistry();
        try {
            new MetricsConfiguration().assistantMeters(beans.getBeanProvider(
                    io.campuscore.restfulapi.thesis.assistant.AssistantRlsState.class),
                    beans.getBeanProvider(javax.sql.DataSource.class)).bindTo(isolated);
            assertTrue(Double.isNaN(isolated.get("campuscore.assistant.quota.consumed.daily").gauge().value()));
            org.mockito.Mockito.verify(connection, org.mockito.Mockito.never()).prepareStatement(org.mockito.ArgumentMatchers.anyString());
        } finally { isolated.close(); }
    }

    @Test
    void publicWrongKeyAndOrdinaryAuthenticatedScrapesAreDenied() throws Exception {
        mvc.perform(get("/actuator/prometheus")).andExpect(status().isForbidden());
        mvc.perform(get("/actuator/prometheus").header("X-Metrics-Key", "wrong"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/actuator/prometheus").with(
                org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors
                        .jwt().authorities(new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_ADMIN"))))
                .andExpect(status().isForbidden());
    }

    @org.junit.jupiter.api.Nested
    @SpringBootTest(properties = "management.metrics.scrape-key=")
    class DisabledScrape {
        @Autowired MockMvc unconfigured;

        @Test
        void emptyConfigurationDeniesEvenAProvidedKey() throws Exception {
            unconfigured.perform(get("/actuator/prometheus").header("X-Metrics-Key", "fixture-scrape-key"))
                    .andExpect(status().isForbidden());
        }
    }
}
