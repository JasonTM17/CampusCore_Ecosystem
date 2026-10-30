package io.campuscore.restfulapi.identity;

import java.time.Instant;
import java.util.Base64;
import java.util.Set;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.keygen.Base64StringKeyGenerator;
import org.springframework.security.crypto.keygen.StringKeyGenerator;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.OAuth2RefreshToken;
import org.springframework.security.oauth2.server.authorization.OAuth2TokenType;
import org.springframework.security.oauth2.server.authorization.authentication.OAuth2ClientAuthenticationToken;
import org.springframework.security.oauth2.server.authorization.token.OAuth2RefreshTokenGenerator;
import org.springframework.security.oauth2.server.authorization.token.OAuth2TokenContext;
import org.springframework.security.oauth2.server.authorization.token.OAuth2TokenGenerator;

/**
 * Refresh-token generator with a scoped public-client exemption
 * (docs/ecosystem/mobile-policy.md §3, KM-3 probe finding). Stock
 * {@link OAuth2RefreshTokenGenerator} refuses to mint refresh tokens for any
 * {@code ClientAuthenticationMethod.NONE} client at the authorization-code
 * exchange. That blanket guard targets browser-based public clients; native
 * apps per RFC 8252 §8 legitimately hold the token in the device keystore
 * (SecureStore) and rotate on every use — this generator replicates the stock
 * semantics but waives the guard only for client ids in
 * {@code identity.oidc.native-refresh-client-ids}. Every other public client
 * keeps the stock no-refresh behavior; confidential clients delegate to the
 * stock generator untouched.
 */
final class NativeRefreshTokenGenerator implements OAuth2TokenGenerator<OAuth2RefreshToken> {

    private final OAuth2RefreshTokenGenerator standard = new OAuth2RefreshTokenGenerator();
    private final StringKeyGenerator keys =
            new Base64StringKeyGenerator(Base64.getUrlEncoder().withoutPadding(), 96);
    private final Set<String> nativeClientIds;

    NativeRefreshTokenGenerator(java.util.Collection<String> nativeClientIds) {
        this.nativeClientIds = nativeClientIds == null ? Set.of() : Set.copyOf(nativeClientIds);
    }

    @Override
    public OAuth2RefreshToken generate(OAuth2TokenContext context) {
        if (!OAuth2TokenType.REFRESH_TOKEN.equals(context.getTokenType())) {
            return null;
        }
        if (!isPublicClient(context)) {
            return this.standard.generate(context);
        }
        if (!this.nativeClientIds.contains(context.getRegisteredClient().getClientId())) {
            return null;
        }
        Instant issuedAt = Instant.now();
        Instant expiresAt = issuedAt.plus(
                context.getRegisteredClient().getTokenSettings().getRefreshTokenTimeToLive());
        return new OAuth2RefreshToken(this.keys.generateKey(), issuedAt, expiresAt);
    }

    /** Mirrors {@code OAuth2RefreshTokenGenerator.isPublicClientForAuthorizationCodeGrant}. */
    private static boolean isPublicClient(OAuth2TokenContext context) {
        Authentication grant = context.getAuthorizationGrant();
        return grant != null
                && grant.getPrincipal() instanceof OAuth2ClientAuthenticationToken client
                && ClientAuthenticationMethod.NONE.equals(client.getClientAuthenticationMethod());
    }
}
