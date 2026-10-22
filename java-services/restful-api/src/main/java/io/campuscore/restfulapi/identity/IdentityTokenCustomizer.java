package io.campuscore.restfulapi.identity;

import io.campuscore.restfulapi.auth.repository.AuthUserRepository;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.security.oauth2.server.authorization.OAuth2TokenType;
import org.springframework.security.oauth2.server.authorization.token.JwtEncodingContext;
import org.springframework.security.oauth2.server.authorization.token.OAuth2TokenCustomizer;

/**
 * Embeds the legacy access-token claim set into OIDC access tokens so
 * {@code AccountStateFilter.matchesCurrentAuthorization} enforces the same
 * current-account gate on both lanes (identity-contract.md §2.1). Claims
 * are read from the account row at issue time — never copied from a
 * possibly-stale incoming token — so a refresh grant always mints with the
 * current credentialVersion.
 */
public class IdentityTokenCustomizer implements OAuth2TokenCustomizer<JwtEncodingContext> {

    private final AuthUserRepository users;

    public IdentityTokenCustomizer(AuthUserRepository users) {
        this.users = users;
    }

    @Override
    public void customize(JwtEncodingContext context) {
        if (!OAuth2TokenType.ACCESS_TOKEN.equals(context.getTokenType())) {
            return;
        }
        String userId = context.getAuthorization() != null
                ? context.getAuthorization().getPrincipalName()
                : context.getPrincipal().getName();
        AuthUserRepository.AccountAuthorization state = users
                .findAccountAuthorization(userId)
                .orElseThrow(() -> new IllegalStateException(
                        "identity token issue for a missing account"));
        context.getClaims()
                .claim("tokenType", "access")
                .claim("credentialVersion", state.credentialVersion())
                .claim("roles", new ArrayList<>(state.roles()))
                .claim("permissions", new ArrayList<>(state.permissions()));
        if (state.studentId() != null) {
            context.getClaims().claim("studentId", state.studentId());
        }
        if (state.lecturerId() != null) {
            context.getClaims().claim("lecturerId", state.lecturerId());
        }
        if (state.studentYear() != null) {
            // LinkedHashMap (not Map.of) so the immutable-collections type id
            // is never written into persisted authorization attributes.
            context.getClaims().claim("student", new LinkedHashMap<>(Map.of("year", state.studentYear())));
        }
    }
}
