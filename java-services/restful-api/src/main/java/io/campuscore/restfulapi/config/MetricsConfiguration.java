package io.campuscore.restfulapi.config;

import io.campuscore.restfulapi.thesis.assistant.AssistantRlsState;
import io.micrometer.common.KeyValue;
import io.micrometer.common.KeyValues;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.binder.MeterBinder;
import io.micrometer.core.instrument.config.MeterFilter;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Date;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.ZoneId;
import javax.sql.DataSource;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.security.autoconfigure.actuate.web.servlet.EndpointRequest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.server.observation.DefaultServerRequestObservationConvention;
import org.springframework.http.server.observation.ServerRequestObservationContext;
import org.springframework.http.server.observation.ServerRequestObservationConvention;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

/** Internal, bounded telemetry; no changes to application readiness or quota policy. */
@Configuration(proxyBeanMethods = false)
public class MetricsConfiguration {
    @Bean
    @Order(-30)
    SecurityFilterChain metricsSecurity(HttpSecurity http,
            @Value("${management.metrics.scrape-key:}") String key) throws Exception {
        byte[] expected = key.getBytes(StandardCharsets.UTF_8);
        http.securityMatcher(EndpointRequest.to("prometheus"))
                .csrf(AbstractHttpConfigurer::disable)
                .requestCache(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth.anyRequest().access((authentication, context) -> {
                    String supplied = context.getRequest().getHeader("X-Metrics-Key");
                    return new AuthorizationDecision(expected.length > 0 && supplied != null
                            && "GET".equals(context.getRequest().getMethod())
                            && MessageDigest.isEqual(expected, supplied.getBytes(StandardCharsets.UTF_8)));
                }))
                .exceptionHandling(errors -> errors.authenticationEntryPoint((request, response, failure) -> response.setStatus(403))
                        .accessDeniedHandler((request, response, failure) -> response.setStatus(403)));
        return http.build();
    }

    @Bean
    MeterFilter boundedHttpRoutes() {
        return MeterFilter.maximumAllowableTags("http.server.requests", "uri", 1024, MeterFilter.deny());
    }

    @Bean
    ServerRequestObservationConvention boundedHttpObservationConvention() {
        return new DefaultServerRequestObservationConvention() {
            @Override
            protected KeyValue uri(ServerRequestObservationContext context) {
                String path = context.getCarrier().getRequestURI();
                // Security filters can finish these fixed routes before MVC supplies a template.
                if (context.getPathPattern() == null
                        && ("/api/v1/auth/login".equals(path) || "/oauth2/token".equals(path))) {
                    return KeyValue.of("uri", path);
                }
                return super.uri(context);
            }

            @Override
            public KeyValues getHighCardinalityKeyValues(ServerRequestObservationContext context) {
                return KeyValues.empty();
            }
        };
    }

    @Bean
    MeterBinder assistantMeters(ObjectProvider<AssistantRlsState> rls,
            @Qualifier("assistantDataSource") ObjectProvider<DataSource> assistant) {
        return registry -> {
            registry.counter("campuscore.assistant.requests", "degraded", "true");
            registry.counter("campuscore.assistant.requests", "degraded", "false");
            registry.counter("campuscore.assistant.turn.stale.recovered");
            Gauge.builder("campuscore.assistant.rls.verified", rls, states -> {
                AssistantRlsState state = states.getIfAvailable();
                return state != null && state.verified() ? 1 : 0;
            }).strongReference(true).register(registry);
            Gauge.builder("campuscore.assistant.quota.consumed.daily", assistant,
                    sources -> committedDailyQuota(sources, rls)).strongReference(true).register(registry);
        };
    }

    private static double committedDailyQuota(ObjectProvider<DataSource> assistant, ObjectProvider<AssistantRlsState> rls) {
        DataSource source = assistant.getIfAvailable();
        if (source == null) return Double.NaN;
        // A separate physical borrow avoids observing the caller's uncommitted charge/refund.
        try (var connection = source.getConnection()) {
            if (!"PostgreSQL".equals(connection.getMetaData().getDatabaseProductName())) {
                return readDailyQuota(connection);
            }
            AssistantRlsState state = rls.getIfAvailable();
            if (state == null || !state.verified()) return Double.NaN;
            connection.setReadOnly(true);
            connection.setAutoCommit(false);
            try {
                // Existing GLOBAL read policy only. Empty owner matches no private user rows.
                // Settings are transaction-local and rolled back before returning the connection.
                try (var context = connection.prepareStatement("SELECT "
                        + "set_config('app.assistant.scope','INTERNAL_OWNER',true),"
                        + "set_config('app.assistant.owner_id','',true),"
                        + "set_config('app.assistant.admin','false',true)")) {
                    context.setQueryTimeout(1);
                    context.execute();
                }
                return readDailyQuota(connection);
            } finally {
                connection.rollback();
            }
        } catch (SQLException failure) {
            return Double.NaN;
        }
    }

    private static double readDailyQuota(java.sql.Connection connection) throws SQLException {
        try (var statement = connection.prepareStatement("SELECT request_count FROM assistant.usage_bucket "
                + "WHERE bucket_date=? AND owner_id='*' AND scope='GLOBAL'")) {
            statement.setQueryTimeout(1);
            statement.setDate(1, Date.valueOf(LocalDate.now(ZoneId.of("Asia/Ho_Chi_Minh"))));
            try (var result = statement.executeQuery()) {
                if (!result.next()) return 0;
                int used = result.getInt(1);
                return result.wasNull() ? Double.NaN : used;
            }
        }
    }

    public static void initializeAnswerMeters(MeterRegistry registry) {
        registry.counter("campuscore.assistant.requests", "degraded", "true");
        registry.counter("campuscore.assistant.requests", "degraded", "false");
    }

    public static void recordAnswer(MeterRegistry registry, boolean degraded) {
        if (registry != null) {
            registry.counter("campuscore.assistant.requests", "degraded", Boolean.toString(degraded)).increment();
        }
    }
}
