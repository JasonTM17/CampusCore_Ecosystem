package io.campuscore.restfulapi.identity;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Bounded cleanup for identity tables (identity-contract.md §2.1): purges
 * fully-expired authorization rows, USED lineage hashes, and logout audit
 * rows past the grace window — same retention pattern as
 * {@code PasswordResetTokenRetentionJob}. Runs on the primary datasource
 * with qualified names so it works whether or not the OIDC pool exists.
 * Enabled only when the OIDC surface is; {@code identity.retention.enabled}
 * can still pause it.
 */
@Component
@Profile("persistence")
@ConditionalOnProperty(prefix = "identity.retention", name = "enabled",
        havingValue = "true", matchIfMissing = true)
public class IdentityGrantRetentionJob {

    private static final Logger log = LoggerFactory.getLogger(IdentityGrantRetentionJob.class);

    private final NamedParameterJdbcTemplate jdbc;
    private final IdentityProperties properties;
    private final Clock clock;

    @Autowired
    public IdentityGrantRetentionJob(NamedParameterJdbcTemplate jdbc,
            IdentityProperties properties) {
        this(jdbc, properties, Clock.systemUTC());
    }

    IdentityGrantRetentionJob(NamedParameterJdbcTemplate jdbc,
            IdentityProperties properties, Clock clock) {
        this.jdbc = jdbc;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * Daily off-peak sweep; each statement is a bounded set delete. This is
     * the one grant-row delete that does not take the account's User row
     * lock — deliberately: the victim set is provably disjoint from every
     * live save, since a save only ever carries a provider-validated live
     * token whose expiry column is after the cutoff. Per-user locking a
     * multi-account batch would trade a non-live-grant race for a lock
     * storm. Worst case is a re-inserted dead-token row, which provider
     * expiry checks and the JWT's own expiry already refuse.
     */
    @Scheduled(cron = "${identity.retention.cron:0 39 4 * * *}")
    public void purgeExpired() {
        if (!properties.getOidc().isEnabled()) {
            return;
        }
        Instant cutoff = clock.instant().minus(properties.getRetention().getGrace());
        Timestamp cutoffTs = Timestamp.from(cutoff);
        MapSqlParameterSource params = new MapSqlParameterSource("cutoff", cutoffTs);

        int authz = jdbc.update(
                "DELETE FROM campuscore_identity.oauth2_authorization WHERE"
                        + " COALESCE(access_token_expires_at, 'epoch') < :cutoff"
                        + " AND COALESCE(refresh_token_expires_at, 'epoch') < :cutoff"
                        + " AND COALESCE(authorization_code_expires_at, 'epoch') < :cutoff"
                        + " AND COALESCE(oidc_id_token_expires_at, 'epoch') < :cutoff",
                params);
        int lineage = jdbc.update(
                // LIVE rows stay regardless of age: pruning them would erase
                // the replay-attribution record while the lineage is still
                // armed. Terminal states prune by their own timestamps.
                "DELETE FROM campuscore_identity.oidc_refresh_lineage WHERE"
                        + " (state = 'USED' AND used_at < :cutoff)"
                        + " OR (state <> 'LIVE' AND created_at < :cutoff)",
                params);
        int audit = jdbc.update(
                "DELETE FROM campuscore_identity.logout_audit WHERE created_at < :cutoff",
                params);
        // BFF lanes (P05): expired sessions and abandoned authorize legs are
        // pure garbage — a live session never satisfies these predicates, so
        // the sweep cannot strand an active cookie (KM-M8).
        int bffSessions = jdbc.update(
                "DELETE FROM campuscore_identity.bff_session WHERE"
                        + " expires_at < :cutoff OR revoked_at < :cutoff",
                params);
        int bffTx = jdbc.update(
                "DELETE FROM campuscore_identity.bff_transaction"
                        + " WHERE expires_at < :cutoff",
                params);
        if (authz + lineage + audit + bffSessions + bffTx > 0) {
            log.info("IDENTITY_GRANT_RETENTION authz={} lineage={} audit={} bffSessions={} bffTx={} cutoff={}",
                    authz, lineage, audit, bffSessions, bffTx, cutoff);
        }
    }
}
