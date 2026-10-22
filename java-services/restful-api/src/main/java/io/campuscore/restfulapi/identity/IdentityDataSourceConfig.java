package io.campuscore.restfulapi.identity;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Second bounded pool for SAS persistence (identity-contract.md §2.1):
 * {@code JdbcOAuth2AuthorizationService} emits an unqualified table name,
 * which must resolve to {@code campuscore_identity} — the primary pool is
 * pinned to {@code currentSchema=thesis}. Same URL/credentials; the schema
 * is set via the driver-agnostic {@code Connection.setSchema}, so the H2
 * test mirror works identically.
 *
 * <p>{@link IdentityProperties} is enabled in {@code IdentityModuleConfig}
 * (unconditional) — binding it here would leave flag-off contexts without
 * the properties bean that always-on components depend on.
 */
@Configuration
@ConditionalOnProperty(prefix = "identity.oidc", name = "enabled", havingValue = "true")
public class IdentityDataSourceConfig {

    @Bean(destroyMethod = "close")
    HikariDataSource identityDataSource(
            @Value("${spring.datasource.url}") String url,
            @Value("${spring.datasource.username}") String username,
            @Value("${spring.datasource.password}") String password) {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(url);
        config.setUsername(username);
        config.setPassword(password);
        // Hikari's setSchema goes through Connection.setSchema, which quotes
        // the identifier on H2 — the unquoted DDL-folded schema name would
        // never match. connectionInitSql keeps the statement in each
        // driver's own syntax instead.
        if (url != null && url.startsWith("jdbc:h2:")) {
            config.setConnectionInitSql("SET SCHEMA campuscore_identity");
        } else {
            config.setConnectionInitSql("SET search_path TO campuscore_identity");
        }
        config.setMaximumPoolSize(4);
        config.setMinimumIdle(0);
        config.setPoolName("identity-pool");
        return new HikariDataSource(config);
    }

    @Bean
    JdbcOperations identityJdbcOperations(
            @Qualifier("identityDataSource") HikariDataSource identityDataSource) {
        return new JdbcTemplate(identityDataSource);
    }
}
