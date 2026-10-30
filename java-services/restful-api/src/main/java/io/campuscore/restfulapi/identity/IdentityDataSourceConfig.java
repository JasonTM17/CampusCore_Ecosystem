package io.campuscore.restfulapi.identity;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.util.regex.Pattern;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.TransactionAwareDataSourceProxy;

/**
 * Logical datasource for SAS persistence (identity-contract.md §2.1):
 * {@code JdbcOAuth2AuthorizationService} and
 * {@code JdbcOAuth2AuthorizationConsentService} emit unqualified table
 * names pinned to {@code campuscore_identity}, while the primary pool is
 * pinned to {@code currentSchema=thesis}. Their statements run through a
 * transaction-aware proxy of the primary datasource, so the grant row,
 * the mirrored {@code campuscore_auth."Session"} row and the refresh
 * lineage record all commit on the primary transaction's single
 * connection — there is no second-pool commit window for a grant to
 * survive its mirror's rollback or a delete to outlive it.
 *
 * <p>The schema is injected into the statement text, never into session
 * state: pooled connections return with their {@code search_path}
 * untouched, so this stays portable across Postgres and the H2 test
 * mirror.
 */
@Configuration
@ConditionalOnProperty(prefix = "identity.oidc", name = "enabled", havingValue = "true")
public class IdentityDataSourceConfig {

    private static final String IDENTITY_SCHEMA = "campuscore_identity";

    /** SAS's fixed unqualified table names, only when not already qualified or quoted. */
    private static final Pattern UNQUALIFIED_IDENTITY_TABLE = Pattern.compile(
            "(?<![\\w$.\"'])oauth2_authorization(?:_consent)?\\b");

    /**
     * Transaction-aware view of the primary datasource: inside a primary
     * transaction every call reuses the bound connection, outside one it
     * borrows a pooled connection per operation. Grant and consent SQL
     * therefore participates in the same commit as the session mirror and
     * the account freshness checks that precede it.
     */
    @Bean
    DataSource identityDataSource(@Qualifier("dataSource") DataSource primaryDataSource) {
        return new TransactionAwareDataSourceProxy(primaryDataSource);
    }

    @Bean
    JdbcOperations identityJdbcOperations(
            @Qualifier("identityDataSource") DataSource identityDataSource) {
        return schemaQualified(new JdbcTemplate(identityDataSource));
    }

    /**
     * Qualifies SAS's fixed bare table names onto {@code campuscore_identity}
     * at the {@link JdbcOperations} boundary — the layer every statement text
     * passes through, whether or not a transaction-bound connection is being
     * reused. Callback/creator arguments carry their own statement and pass
     * unchanged.
     */
    private static JdbcOperations schemaQualified(JdbcOperations delegate) {
        return (JdbcOperations) Proxy.newProxyInstance(
                IdentityDataSourceConfig.class.getClassLoader(),
                new Class<?>[] {JdbcOperations.class},
                (proxy, method, args) -> {
                    if (args != null && args.length > 0) {
                        if (args[0] instanceof String sql) {
                            args[0] = qualifyIdentityTables(sql);
                        } else if (args[0] instanceof String[] statements) {
                            String[] qualified = statements.clone();
                            for (int index = 0; index < qualified.length; index++) {
                                qualified[index] = qualifyIdentityTables(qualified[index]);
                            }
                            args[0] = qualified;
                        }
                    }
                    try {
                        return method.invoke(delegate, args);
                    } catch (InvocationTargetException exception) {
                        throw exception.getTargetException();
                    }
                });
    }

    private static String qualifyIdentityTables(String sql) {
        return UNQUALIFIED_IDENTITY_TABLE.matcher(sql)
                .replaceAll(match -> IDENTITY_SCHEMA + "." + match.group());
    }
}
