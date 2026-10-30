package io.campuscore.restfulapi.identity;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.proc.JWSKeySelector;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.JWT;
import com.nimbusds.jwt.JWTParser;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import java.text.ParseException;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimNames;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

/**
 * Explicit two-validator dispatch on the raw {@code iss} claim
 * (identity-contract.md §2.1 — the legacy issuer is not a URL, so the
 * trusted-issuer resolver cannot apply):
 *
 * <ul>
 *   <li>{@code iss == identity.issuer-uri} → RS256 ring decoder: issuer +
 *       timestamp + audience ⊆ registered clientIds.</li>
 *   <li>anything else → the legacy HS256 decoder, which keeps enforcing its
 *       own signature; its issuer is implied by the secret.</li>
 * </ul>
 *
 * Both lanes then pass the shared access-shape check ({@code tokenType=access}
 * + {@code roles} present) — OIDC access tokens carry the same claims because
 * the token customizer embeds them. OIDC refresh tokens are opaque and fail
 * at parse, before any signature work. No loose fallback: a token that does
 * not decode under its own lane is rejected, never retried on the other.
 */
public final class IdentityJwtDecoder implements JwtDecoder {

    private final String oidcIssuer;
    private final JwtDecoder legacyDecoder;
    private final JwtDecoder oidcDecoder;
    private final java.util.function.Function<Jwt, Jwt> accessShape;

    public IdentityJwtDecoder(String oidcIssuer, JWKSource<SecurityContext> jwkSource,
            Set<String> clientIds, JwtDecoder legacyDecoder,
            java.util.function.Function<Jwt, Jwt> accessShape) {
        this.oidcIssuer = oidcIssuer;
        this.legacyDecoder = legacyDecoder;
        this.accessShape = accessShape;
        this.oidcDecoder = buildOidcDecoder(jwkSource, clientIds, oidcIssuer);
    }

    private static JwtDecoder buildOidcDecoder(JWKSource<SecurityContext> jwkSource,
            Set<String> clientIds, String issuer) {
        JWSKeySelector<SecurityContext> keySelector =
                new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, jwkSource);
        DefaultJWTProcessor<SecurityContext> processor = new DefaultJWTProcessor<>();
        processor.setJWSKeySelector(keySelector);
        NimbusJwtDecoder decoder = new NimbusJwtDecoder(processor);
        OAuth2TokenValidator<Jwt> audience = new JwtClaimValidator<List<String>>(
                JwtClaimNames.AUD,
                aud -> aud != null && !Collections.disjoint(aud, clientIds));
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                JwtValidators.createDefaultWithIssuer(issuer), audience));
        return decoder;
    }

    @Override
    public Jwt decode(String token) {
        String issuer = unverifiedIssuer(token);
        JwtDecoder lane = oidcIssuer.equals(issuer) ? oidcDecoder : legacyDecoder;
        return accessShape.apply(lane.decode(token));
    }

    /**
     * Raw OIDC-lane decode without the access-token shape check — for
     * id_tokens (host-policy §3 callback verification): signature, issuer,
     * expiry and audience are all enforced; nonce/aud matching stays with
     * the caller.
     */
    public Jwt decodeOidc(String token) {
        return oidcDecoder.decode(token);
    }

    private static String unverifiedIssuer(String token) {
        try {
            JWT jwt = JWTParser.parse(token);
            String issuer = jwt.getJWTClaimsSet().getIssuer();
            return issuer == null ? "" : issuer;
        } catch (ParseException exception) {
            throw new BadCredentialsException("Malformed bearer token", exception);
        }
    }
}
