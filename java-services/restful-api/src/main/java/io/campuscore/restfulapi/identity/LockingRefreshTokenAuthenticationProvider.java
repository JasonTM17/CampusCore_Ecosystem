package io.campuscore.restfulapi.identity;

import io.campuscore.restfulapi.auth.repository.AuthUserRepository;
import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.server.authorization.OAuth2Authorization;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.OAuth2TokenType;
import org.springframework.security.oauth2.server.authorization.authentication.OAuth2RefreshTokenAuthenticationToken;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionOperations;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Atomic refresh-grant consumption (identity-contract.md §2.3). The stock
 * SAS refresh provider validates the grant loaded by {@code findByToken}
 * and persists the rotated row in a later {@code save}; with no
 * encompassing transaction two requests can both load the same live
 * generation and both rotate — the second save overwrites the first
 * replacement and the orphaned winner is later rejected as replay. This
 * provider runs the whole consume on one primary-datasource transaction:
 * resolve the presented generation to its account, take the User row
 * lock, then run the stock provider so its own lookup and save happen
 * after the lock. A loser serialized behind a committed rotation
 * re-reads post-commit state — the rotated-away value no longer
 * resolves — and exits through the normal {@code invalid_grant} replay
 * path instead of overwriting the winner. Lock order stays
 * User → grant tables, matching every other identity mutation, and the
 * delegate's {@code save} still joins this transaction so the grant,
 * mirror and lineage writes share one commit.
 */
public class LockingRefreshTokenAuthenticationProvider implements AuthenticationProvider {

    private final AuthenticationProvider delegate;
    private final OAuth2AuthorizationService authorizations;
    private final AuthUserRepository users;
    private final TransactionOperations transactions;

    public LockingRefreshTokenAuthenticationProvider(AuthenticationProvider delegate,
            OAuth2AuthorizationService authorizations, AuthUserRepository users,
            PlatformTransactionManager transactionManager) {
        this.delegate = delegate;
        this.authorizations = authorizations;
        this.users = users;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    @Override
    public Authentication authenticate(Authentication authentication) throws AuthenticationException {
        String presented = ((OAuth2RefreshTokenAuthenticationToken) authentication).getRefreshToken();
        return this.transactions.execute(status -> {
            // Account resolution has to precede the lock: the presented
            // value alone says nothing about which row serializes its
            // consumption. The delegate re-reads under the lock, so a
            // generation rotated away while this request waited surfaces
            // there — never as a stale overwrite. A miss skips the lock and
            // lets the delegate emit the stock invalid_grant error shape.
            OAuth2Authorization grant = this.authorizations.findByToken(
                    presented, OAuth2TokenType.REFRESH_TOKEN);
            if (grant != null) {
                this.users.lockUserRow(grant.getPrincipalName());
            }
            return this.delegate.authenticate(authentication);
        });
    }

    @Override
    public boolean supports(Class<?> authentication) {
        return OAuth2RefreshTokenAuthenticationToken.class.isAssignableFrom(authentication);
    }
}
