package io.campuscore.restfulapi.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.JWTParser;
import com.nimbusds.jwt.SignedJWT;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.util.Base64;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * OIDC surface contract (docs/ecosystem/identity-contract.md §3): discovery,
 * JWKS ring, authorize+code+PKCE+nonce, protocol negatives, disabled/must-
 * change gates, at-rest encryption, and the dual-lane resource decoder.
 * Runs the real H2 migration set so the SAS persistence schema is the same
 * DDL Postgres gets — only the key material and client registry are
 * test-scoped.
 */
@SpringBootTest
@AutoConfigureMockMvc(print = org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint.NONE)
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "identity.oidc.enabled=true",
        "identity.oidc.dev-keygen=true",
        "identity.oidc.issuer-uri=http://127.0.0.1:4010",
        "identity.oidc.token-encryption-key=dGVzdC1rZXktMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY=",
        "identity.clients[0].client-id=cu-hub",
        "identity.clients[0].client-secret=it-secret-0123456789abcdef0123456789",
        "identity.clients[0].redirect-uris[0]=http://127.0.0.1:3100/session/callback",
        "identity.clients[0].redirect-uris[1]=http://localhost:3100/session/callback",
        "identity.clients[0].post-logout-redirect-uris[0]=http://127.0.0.1:3100/",
        "identity.clients[0].scopes[0]=openid",
        "identity.clients[0].scopes[1]=profile",
        "identity.clients[0].scopes[2]=email",
        "identity.clients[0].access-token-ttl=PT15M",
        "identity.clients[0].refresh-token-ttl=P7D"
})
class EcosystemIdentityContractTest {

    private static final String ISSUER = "http://127.0.0.1:4010";
    private static final String CLIENT = "cu-hub";
    private static final String SECRET = "it-secret-0123456789abcdef0123456789";
    private static final String CALLBACK = "http://127.0.0.1:3100/session/callback";
    private static final String PASSWORD = "it-identity-password-1";

    @Autowired private MockMvc mvc;
    private final JdbcTemplate jdbc;

    EcosystemIdentityContractTest(@Autowired javax.sql.DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }
    @Autowired private ObjectMapper mapper;
    @Autowired private PasswordEncoder passwordEncoder;
    @Autowired @Qualifier("identityJwtDecoder") private JwtDecoder identityDecoder;
    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean
    private IdentitySessionMirror logoutMirror;

    @BeforeEach
    void resetDemoAccount() {
        jdbc.update(
                "UPDATE campuscore_auth.\"User\" SET \"password\" = ?, \"status\" = 'ACTIVE',"
                        + " \"mustChangePassword\" = FALSE WHERE \"id\" = 'student-user'",
                passwordEncoder.encode(PASSWORD));
    }

    // ---- discovery + keys -------------------------------------------------

    @Test
    void discoveryDocumentIsContractShaped() throws Exception {
        MvcResult result = mvc.perform(get("/.well-known/openid-configuration"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.issuer").value(ISSUER))
                .andExpect(jsonPath("$.authorization_endpoint").exists())
                .andExpect(jsonPath("$.token_endpoint").exists())
                .andExpect(jsonPath("$.jwks_uri").exists())
                .andExpect(jsonPath("$.response_types_supported").isArray())
                .andExpect(jsonPath("$.subject_types_supported").isArray())
                .andExpect(jsonPath("$.id_token_signing_alg_values_supported").isArray())
                .andReturn();
        JsonNode doc = mapper.readTree(result.getResponse().getContentAsString());
        assertThat(doc.get("jwks_uri").asText()).startsWith(ISSUER);
    }

    @Test
    void jwksPublishesTheWholeSigningRing() throws Exception {
        MvcResult result = mvc.perform(get("/oauth2/jwks"))
                .andExpect(status().isOk()).andReturn();
        JsonNode keys = mapper.readTree(result.getResponse().getContentAsString()).get("keys");
        // dev-keygen ships an active and a previous key: rollover overlap.
        assertThat(keys.size()).isGreaterThanOrEqualTo(2);
        for (JsonNode key : keys) {
            assertThat(key.get("kty").asText()).isEqualTo("RSA");
            assertThat(key.get("kid").asText()).isNotBlank();
            assertThat(key.has("d")).as("private material never publishes").isFalse();
        }
    }

    // ---- full grant --------------------------------------------------------

    @Test
    void authorizeCodePkceNonceFlowMintsClaimShapedTokens() throws Exception {
        Cookie access = login();
        String verifier = pkceVerifier();
        String challenge = pkceChallenge(verifier);

        MvcResult redirect = mvc.perform(get("/oauth2/authorize")
                        .cookie(access)
                        .queryParam("response_type", "code")
                        .queryParam("client_id", CLIENT)
                        .queryParam("redirect_uri", CALLBACK)
                        .queryParam("scope", "openid profile email")
                        .queryParam("state", "st-42")
                        .queryParam("nonce", "nonce-17")
                        .queryParam("code_challenge", challenge)
                        .queryParam("code_challenge_method", "S256"))
                .andExpect(status().is3xxRedirection())
                .andReturn();
        String location = redirect.getResponse().getHeader("Location");
        assertThat(location).startsWith(CALLBACK);
        String code = queryParam(location, "code");
        assertThat(code).isNotBlank();
        assertThat(queryParam(location, "state")).isEqualTo("st-42");

        MvcResult token = mvc.perform(post("/oauth2/token")
                        .with(httpBasic(CLIENT, SECRET))
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("grant_type", "authorization_code")
                        .param("code", code)
                        .param("redirect_uri", CALLBACK)
                        .param("code_verifier", verifier))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.access_token").exists())
                .andExpect(jsonPath("$.refresh_token").exists())
                .andExpect(jsonPath("$.id_token").exists())
                .andReturn();
        JsonNode body = mapper.readTree(token.getResponse().getContentAsString());

        JWTClaimsSet accessClaims = JWTParser.parse(body.get("access_token").asText())
                .getJWTClaimsSet();
        assertThat(accessClaims.getIssuer()).isEqualTo(ISSUER);
        assertThat(accessClaims.getAudience()).contains(CLIENT);
        assertThat(accessClaims.getSubject()).isEqualTo("student-user");
        assertThat(accessClaims.getStringClaim("tokenType")).isEqualTo("access");
        assertThat(accessClaims.getClaim("credentialVersion")).isNotNull();
        assertThat((List<Object>) accessClaims.getClaim("roles")).contains("STUDENT");

        JWTClaimsSet idClaims = JWTParser.parse(body.get("id_token").asText())
                .getJWTClaimsSet();
        assertThat(idClaims.getStringClaim("nonce")).isEqualTo("nonce-17");
        assertThat(idClaims.getIssuer()).isEqualTo(ISSUER);
    }

    @Test
    void oidcAccessTokenAuthorizesTheResourceLane() throws Exception {
        Cookie access = login();
        JsonNode tokens = exchangeCode(access, pkceVerifier(), "nonce-a");
        mvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", "Bearer " + tokens.get("access_token").asText()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("student-user"));
    }

    @Test
    void userinfoAnswersWithTheAccountSubject() throws Exception {
        Cookie access = login();
        JsonNode tokens = exchangeCode(access, pkceVerifier(), "nonce-b");
        mvc.perform(get("/userinfo")
                        .header("Authorization", "Bearer " + tokens.get("access_token").asText()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sub").value("student-user"));
    }

    // ---- protocol negatives ------------------------------------------------

    @Test
    void authorizationCodeIsSingleUse() throws Exception {
        Cookie access = login();
        String verifier = pkceVerifier();
        String code = authorize(access, verifier, "nonce-c");
        exchange(code, verifier).andExpect(status().isOk());
        // Second presentation of the same code: the grant row already burned.
        exchange(code, verifier)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("invalid_grant"));
    }

    @Test
    void wrongPkceVerifierIsRejected() throws Exception {
        Cookie access = login();
        String code = authorize(access, pkceVerifier(), "nonce-d");
        exchange(code, pkceVerifier())
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("invalid_grant"));
    }

    @Test
    void redirectUriOutsideTheExactAllowlistIsRejected() throws Exception {
        Cookie access = login();
        String verifier = pkceVerifier();
        mvc.perform(get("/oauth2/authorize")
                        .cookie(access)
                        .queryParam("response_type", "code")
                        .queryParam("client_id", CLIENT)
                        .queryParam("redirect_uri", "http://evil.example/callback")
                        .queryParam("scope", "openid")
                        .queryParam("state", "s")
                        .queryParam("code_challenge", pkceChallenge(verifier))
                        .queryParam("code_challenge_method", "S256"))
                .andExpect(status().is4xxClientError())
                // The failure must not take the form of a redirect to the
                // attacker's URI — that is what the exact-match contract kills.
                .andExpect(result -> {
                    String location = result.getResponse().getHeader("Location");
                    assertThat(location == null || !location.contains("evil.example")).isTrue();
                });
    }

    @Test
    void authorizeWithoutCentralSessionRedirectsToLogin() throws Exception {
        mvc.perform(get("/oauth2/authorize")
                        .queryParam("response_type", "code")
                        .queryParam("client_id", CLIENT)
                        .queryParam("redirect_uri", CALLBACK)
                        .queryParam("scope", "openid")
                        .queryParam("code_challenge", pkceChallenge(pkceVerifier()))
                        .queryParam("code_challenge_method", "S256"))
                .andExpect(status().is3xxRedirection())
                .andExpect(result -> assertThat(result.getResponse().getHeader("Location"))
                        .contains("/login"));
    }

    // ---- account-state gates -------------------------------------------------

    @Test
    void suspendedAccountCannotAuthorize() throws Exception {
        Cookie access = login();
        jdbc.update("UPDATE campuscore_auth.\"User\" SET \"status\" = 'SUSPENDED'"
                + " WHERE \"id\" = 'student-user'");
        mvc.perform(get("/oauth2/authorize")
                        .cookie(access)
                        .queryParam("response_type", "code")
                        .queryParam("client_id", CLIENT)
                        .queryParam("redirect_uri", CALLBACK)
                        .queryParam("scope", "openid")
                        .queryParam("code_challenge", pkceChallenge(pkceVerifier()))
                        .queryParam("code_challenge_method", "S256"))
                .andExpect(status().isFound())
                .andExpect(result -> assertThat(result.getResponse().getHeader("Location"))
                        .startsWith("/login?return="));
    }

    @Test
    void mustChangePasswordAccountCannotAuthorize() throws Exception {
        Cookie access = login();
        jdbc.update("UPDATE campuscore_auth.\"User\" SET \"mustChangePassword\" = TRUE"
                + " WHERE \"id\" = 'student-user'");
        mvc.perform(get("/oauth2/authorize")
                        .cookie(access)
                        .queryParam("response_type", "code")
                        .queryParam("client_id", CLIENT)
                        .queryParam("redirect_uri", CALLBACK)
                        .queryParam("scope", "openid")
                        .queryParam("code_challenge", pkceChallenge(pkceVerifier()))
                        .queryParam("code_challenge_method", "S256"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PASSWORD_CHANGE_REQUIRED"));
    }

    // ---- at-rest encryption --------------------------------------------------

    @Test
    void tokenColumnsStoreCiphertextNotRawTokens() throws Exception {
        Cookie access = login();
        JsonNode tokens = exchangeCode(access, pkceVerifier(), "nonce-e");
        String rawRefresh = tokens.get("refresh_token").asText();
        // Earlier tests leave their own authorizations for the same principal, so
        // assert over every stored row instead of assuming a single one.
        java.util.List<String> stored = jdbc.queryForList(
                "SELECT refresh_token_value FROM campuscore_identity.oauth2_authorization"
                        + " WHERE principal_name = 'student-user' AND refresh_token_value IS NOT NULL",
                String.class);
        assertThat(stored).isNotEmpty();
        assertThat(stored).noneMatch(value -> value.contains(rawRefresh));
        // Round-trip through the same deterministic AEAD proves one row is the
        // ciphertext of the presented token, not a lossy transform.
        DeterministicTokenCipher cipher = new DeterministicTokenCipher(
                "dGVzdC1rZXktMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY=");
        assertThat(stored).anyMatch(value -> {
            try {
                return cipher.decrypt(value, LockingIdentityAuthorizationService.TOKEN_AAD)
                        .equals(rawRefresh);
            } catch (RuntimeException notThisRow) {
                return false;
            }
        });
    }

    // ---- decoder dispatch (pure unit inside the same context) ----------------

    @Test
    void decoderRejectsWrongIssuerAndAudience() throws Exception {
        RSAKey pair = localRing();
        JWKSource<SecurityContext> ring = new ImmutableJWKSet<>(new JWKSet(pair));
        java.util.concurrent.atomic.AtomicBoolean legacyHit = new java.util.concurrent.atomic.AtomicBoolean();
        JwtDecoder legacy = token -> {
            legacyHit.set(true);
            throw new org.springframework.security.oauth2.jwt.JwtException("legacy lane rejects");
        };
        JwtDecoder decoder = new IdentityJwtDecoder(ISSUER, ring, Set.of(CLIENT), legacy,
                jwt -> jwt);

        String good = sign(pair, new JWTClaimsSet.Builder()
                .issuer(ISSUER).audience(CLIENT).subject("u1")
                .expirationTime(new java.util.Date(System.currentTimeMillis() + 60000))
                .build());
        assertThat(decoder.decode(good).getSubject()).isEqualTo("u1");

        String wrongAud = sign(pair, new JWTClaimsSet.Builder()
                .issuer(ISSUER).audience("someone-else").subject("u1")
                .expirationTime(new java.util.Date(System.currentTimeMillis() + 60000))
                .build());
        assertThatThrownBy(() -> decoder.decode(wrongAud))
                .hasMessageContaining("aud");

        // A token whose iss is neither lane's: dispatch sends it to the
        // legacy validator — never silently to OIDC.
        String wrongIss = sign(pair, new JWTClaimsSet.Builder()
                .issuer("https://evil.example").audience(CLIENT).subject("u1")
                .expirationTime(new java.util.Date(System.currentTimeMillis() + 60000))
                .build());
        assertThatThrownBy(() -> decoder.decode(wrongIss));
        assertThat(legacyHit.get()).isTrue();
    }

    @Test
    void decoderHonorsRolloverKeysAcrossTheRing() throws Exception {
        RSAKey active = localRing();
        RSAKey previous = localRing();
        JWKSource<SecurityContext> ring = new ImmutableJWKSet<>(
                new JWKSet(java.util.List.of(active, previous)));
        JwtDecoder decoder = new IdentityJwtDecoder(ISSUER, ring, Set.of(CLIENT),
                jwt -> { throw new org.springframework.security.oauth2.jwt.JwtException("legacy rejects"); },
                jwt -> jwt);

        // Tokens signed by the retired-but-published key must still verify —
        // that overlap window is what makes rollover safe.
        String mintedBeforeRollover = sign(previous, new JWTClaimsSet.Builder()
                .issuer(ISSUER).audience(CLIENT).subject("u-rollover")
                .expirationTime(new java.util.Date(System.currentTimeMillis() + 60000))
                .build());
        assertThat(decoder.decode(mintedBeforeRollover).getSubject()).isEqualTo("u-rollover");
    }

    // ---- AUD-06 logout/CSRF evidence ----------------------------------------

    @Test
    void oidcCookieLogoutRequiresDoubleSubmitBeforeRevocation() throws Exception {
        Cookie access = login();
        JsonNode tokens = exchangeCode(access, pkceVerifier(), "aud06-csrf");
        int before = grantCount();
        var result = mvc.perform(post("/connect/logout").cookie(access)
                .param("id_token_hint", tokens.get("id_token").asText())
                .param("post_logout_redirect_uri", "http://127.0.0.1:3100/"))
                .andReturn().getResponse();
        assertThat(result.getStatus()).as("missing SAS cookie-CSRF must be rejected").isEqualTo(403);
        assertThat(grantCount()).isEqualTo(before);
        assertThat(result.getHeaders("Set-Cookie")).isEmpty();
    }

    @Test
    void oidcCookieLogoutRejectsWrongTokensAndReplayedHintAfterSuccessfulPost() throws Exception {
        Cookie access = login();
        JsonNode tokens = exchangeCode(access, pkceVerifier(), "aud06-post-replay");
        Cookie csrf = new Cookie("cc_csrf", "aud06-boundary-token");
        int before = grantCount();
        for (String token : List.of("", "wrong-token", "other-session-token")) {
            var result = mvc.perform(post("/connect/logout").cookie(access, csrf)
                    .header("X-CSRF-Token", token)
                    .param("client_id", CLIENT)
                    .param("id_token_hint", tokens.get("id_token").asText()))
                    .andReturn().getResponse();
            assertThat(result.getStatus()).isEqualTo(403);
            assertThat(grantCount()).isEqualTo(before);
        }
        var success = mvc.perform(post("/connect/logout").cookie(access, csrf)
                .header("X-CSRF-Token", csrf.getValue()).param("client_id", CLIENT)
                .param("id_token_hint", tokens.get("id_token").asText()))
                .andReturn().getResponse();
        assertThat(success.getStatus()).isEqualTo(204);
        assertThat(grantCount()).isZero();
        var staleTab = mvc.perform(post("/connect/logout").cookie(access, csrf)
                .header("X-CSRF-Token", csrf.getValue()).param("client_id", CLIENT)
                .param("id_token_hint", tokens.get("id_token").asText()))
                .andReturn().getResponse();
        assertThat(staleTab.getStatus()).isEqualTo(400);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.NullAndEmptySource
    @org.junit.jupiter.params.provider.ValueSource(strings = " ")
    void oidcHintWithoutClientIdStillRevokesTheValidatedClientsGrants(String optionalClientId) throws Exception {
        Cookie access = login();
        JsonNode tokens = exchangeCode(access, pkceVerifier(), "aud06-client-omission");
        var request = get("/connect/logout").cookie(access)
                .queryParam("id_token_hint", tokens.get("id_token").asText())
                .queryParam("post_logout_redirect_uri", "http://127.0.0.1:3100/");
        if (optionalClientId != null) request.queryParam("client_id", optionalClientId);
        var result = mvc.perform(request).andReturn().getResponse();
        assertThat(result.getStatus()).isEqualTo(302);
        assertThat(grantCount()).as("optional client_id must not bypass documented per-client revoke").isZero();
    }

    @Test
    void oidcCrossOriginAndOtherSessionDoubleSubmitPairRemainKnownPolicyGaps() throws Exception {
        Cookie access = login();
        JsonNode tokens = exchangeCode(access, pkceVerifier(), "aud06-origin");
        Cookie csrf = java.util.Arrays.stream(loginCookies())
                .filter(cookie -> cookie.getName().equals("cc_csrf")).findFirst().orElseThrow();
        var result = mvc.perform(post("/connect/logout").cookie(access, csrf)
                .header("X-CSRF-Token", csrf.getValue())
                .header("Origin", "https://evil.invalid").header("Referer", "https://evil.invalid/")
                .param("client_id", CLIENT).param("id_token_hint", tokens.get("id_token").asText()))
                .andReturn().getResponse();
        assertThat(result.getStatus()).as("known policy gap: SAS has no Origin/Referer guard")
                .isEqualTo(204);
        assertThat(grantCount()).isZero();
    }

    @Test
    void legacyDoubleSubmitIsNotSessionBoundAndRefererAloneIsNotAnOriginGuard() throws Exception {
        Cookie[] first = loginCookies();
        Cookie[] second = loginCookies();
        Cookie access = java.util.Arrays.stream(first)
                .filter(cookie -> cookie.getName().equals("cc_access_token")).findFirst().orElseThrow();
        Cookie csrf = java.util.Arrays.stream(second)
                .filter(cookie -> cookie.getName().equals("cc_csrf")).findFirst().orElseThrow();
        // Explicit characterization of legacy double-submit: the pair can
        // come from another login; adding session binding needs owner policy.
        var result = mvc.perform(post("/api/v1/auth/logout").cookie(access, csrf)
                .header("X-CSRF-Token", csrf.getValue())
                .header("Referer", "https://evil.invalid/"))
                .andReturn().getResponse();
        assertThat(result.getStatus()).as("known policy gap: Referer is ignored and token pair unbound")
                .isEqualTo(200);
    }

    @Test
    void legacyStaleTabCanRevokeAFreshLoginKnownPolicyGap() throws Exception {
        Cookie oldAccess = login();
        Cookie csrf = new Cookie("cc_csrf", "aud06-stale-tab");
        assertThat(mvc.perform(post("/api/v1/auth/logout").cookie(oldAccess, csrf)
                .header("X-CSRF-Token", csrf.getValue())).andReturn().getResponse().getStatus()).isEqualTo(200);
        Cookie freshAccess = login();
        assertThat(mvc.perform(get("/api/v1/auth/me").cookie(freshAccess))
                .andReturn().getResponse().getStatus()).isEqualTo(200);
        assertThat(mvc.perform(post("/api/v1/auth/logout").cookie(oldAccess, csrf)
                .header("X-CSRF-Token", csrf.getValue())).andReturn().getResponse().getStatus()).isEqualTo(200);
        assertThat(mvc.perform(get("/api/v1/auth/me").cookie(freshAccess))
                .andReturn().getResponse().getStatus())
                .as("known policy gap: stale cleanup request revokes a newly established session").isEqualTo(401);
    }

    @Test
    void oidcRevokeFailureCurrentlyCertifiesLogoutKnownContractGap() throws Exception {
        Cookie access = login();
        JsonNode tokens = exchangeCode(access, pkceVerifier(), "aud06-fault");
        int grantsBefore = grantCount();
        int sessionsBefore = sessionCount();
        org.mockito.Mockito.doThrow(new IllegalStateException("AUD06 synthetic revoke failure"))
                .when(logoutMirror).deleteOidcSessionsForClient("student-user", CLIENT);
        var failed = mvc.perform(get("/connect/logout").cookie(access).queryParam("client_id", CLIENT)
                .queryParam("id_token_hint", tokens.get("id_token").asText())
                .queryParam("post_logout_redirect_uri", "http://127.0.0.1:3100/"))
                .andReturn().getResponse();
        // Characterizes the documented best-effort exception, NOT acceptance.
        assertThat(failed.getStatus()).as("known gap: failure is reported as redirect success")
                .isEqualTo(302);
        assertThat(failed.getHeaders("Set-Cookie")).isEmpty();
        assertThat(grantCount()).as("failed transaction rolls grant deletion back").isEqualTo(grantsBefore);
        assertThat(sessionCount()).as("failed transaction leaves sessions live").isEqualTo(sessionsBefore);
        org.mockito.Mockito.doCallRealMethod().when(logoutMirror)
                .deleteOidcSessionsForClient("student-user", CLIENT);
        var recovered = mvc.perform(get("/connect/logout").cookie(access).queryParam("client_id", CLIENT)
                .queryParam("id_token_hint", tokens.get("id_token").asText())
                .queryParam("post_logout_redirect_uri", "http://127.0.0.1:3100/"))
                .andReturn().getResponse();
        assertThat(recovered.getStatus()).isEqualTo(302);
        assertThat(grantCount()).isZero();
        // A retained hint no longer resolves after successful revocation.
        var replay = mvc.perform(get("/connect/logout").cookie(access).queryParam("client_id", CLIENT)
                .queryParam("id_token_hint", tokens.get("id_token").asText()))
                .andReturn().getResponse();
        assertThat(replay.getStatus()).isEqualTo(400);
    }

    @Test
    void oidcLogoutRejectsUnregisteredAndDuplicateRedirectParameters() throws Exception {
        Cookie access = login();
        JsonNode tokens = exchangeCode(access, pkceVerifier(), "aud06-redirect");
        for (String target : List.of("https://evil.invalid/", "//evil.invalid/",
                "http://127.0.0.1:3100/@evil.invalid", "http://127.0.0.1:3100/%0d%0aLocation:evil")) {
            var result = mvc.perform(get("/connect/logout").cookie(access).queryParam("client_id", CLIENT)
                    .queryParam("id_token_hint", tokens.get("id_token").asText())
                    .queryParam("post_logout_redirect_uri", target)).andReturn().getResponse();
            assertThat(result.getStatus()).as("unregistered logout redirect").isEqualTo(400);
            assertThat(result.getHeader("Location")).isNull();
        }
        var duplicate = mvc.perform(get("/connect/logout").cookie(access).queryParam("client_id", CLIENT)
                .queryParam("id_token_hint", tokens.get("id_token").asText())
                .queryParam("post_logout_redirect_uri", "http://127.0.0.1:3100/", "https://evil.invalid/"))
                .andReturn().getResponse();
        assertThat(duplicate.getStatus()).isEqualTo(400);
        assertThat(duplicate.getHeader("Location")).isNull();
        for (String hint : List.of("", "malformed-not-a-jwt")) {
            var malformed = mvc.perform(get("/connect/logout").cookie(access)
                    .queryParam("id_token_hint", hint)).andReturn().getResponse();
            assertThat(malformed.getStatus()).isEqualTo(400);
            assertThat(malformed.getHeader("Location")).isNull();
        }
        var duplicateHint = mvc.perform(get("/connect/logout").cookie(access)
                .queryParam("id_token_hint", tokens.get("id_token").asText(), tokens.get("id_token").asText()))
                .andReturn().getResponse();
        assertThat(duplicateHint.getStatus()).isEqualTo(400);
    }

    @Test
    void legacyLogoutRevokeFailureRollsBackAndPreservesCookiesUntilRetry() throws Exception {
        Cookie access = login();
        int sessionsBefore = sessionCount();
        org.mockito.Mockito.doThrow(new IllegalStateException("AUD06 synthetic revoke failure"))
                .when(logoutMirror).deleteLineageForUser("student-user");
        Cookie csrf = new Cookie("cc_csrf", "aud06-double-submit");
        var failure = mvc.perform(post("/api/v1/auth/logout").cookie(access, csrf)
                .header("X-CSRF-Token", csrf.getValue())).andReturn().getResponse();
        assertThat(failure.getStatus()).isEqualTo(500);
        assertThat(failure.getHeaders("Set-Cookie")).isEmpty();
        assertThat(sessionCount()).as("no half-revoked legacy session state").isEqualTo(sessionsBefore);
        org.mockito.Mockito.doCallRealMethod().when(logoutMirror).deleteLineageForUser("student-user");
        var recovered = mvc.perform(post("/api/v1/auth/logout").cookie(access, csrf)
                .header("X-CSRF-Token", csrf.getValue())).andReturn().getResponse();
        assertThat(recovered.getStatus()).isEqualTo(200);
        assertThat(recovered.getHeaders("Set-Cookie")).hasSize(3)
                .allMatch(value -> value.contains("Max-Age=0"));
        assertThat(sessionCount()).isZero();
        var staleTab = mvc.perform(post("/api/v1/auth/logout").cookie(access, csrf)
                .header("X-CSRF-Token", csrf.getValue())).andReturn().getResponse();
        assertThat(staleTab.getStatus()).as("documented legacy cleanup idempotence").isEqualTo(200);
        assertThat(mvc.perform(get("/api/v1/auth/me").cookie(access))
                .andReturn().getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    void legacyLogoutRejectsMissingWrongCsrfAndForeignOrigin() throws Exception {
        Cookie access = login();
        Cookie csrf = new Cookie("cc_csrf", "aud06-double-submit");
        int before = sessionCount();
        for (String token : List.of("", "wrong", "another-session")) {
            var result = mvc.perform(post("/api/v1/auth/logout").cookie(access, csrf)
                    .header("X-CSRF-Token", token)).andReturn().getResponse();
            assertThat(result.getStatus()).isEqualTo(403);
            assertThat(result.getHeaders("Set-Cookie")).isEmpty();
        }
        var crossOrigin = mvc.perform(post("/api/v1/auth/logout").cookie(access, csrf)
                .header("X-CSRF-Token", csrf.getValue()).header("Origin", "https://evil.invalid"))
                .andReturn().getResponse();
        assertThat(crossOrigin.getStatus()).isEqualTo(403);
        assertThat(sessionCount()).isEqualTo(before);
        assertThat(mvc.perform(get("/api/v1/auth/logout").cookie(access))
                .andReturn().getResponse().getStatus()).isEqualTo(405);
        var malformedBody = mvc.perform(post("/api/v1/auth/logout").cookie(access, csrf)
                .header("X-CSRF-Token", csrf.getValue()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"refreshToken\":[\"one\",\"two\"]}"))
                .andReturn().getResponse();
        assertThat(malformedBody.getStatus()).isEqualTo(400);
        assertThat(malformedBody.getHeaders("Set-Cookie")).isEmpty();
        assertThat(sessionCount()).isEqualTo(before);
    }

    private int grantCount() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM campuscore_identity.oauth2_authorization"
                + " WHERE principal_name='student-user' AND registered_client_id='cu-hub'", Integer.class);
    }

    private int sessionCount() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM campuscore_auth.\"Session\""
                + " WHERE \"userId\"='student-user'", Integer.class);
    }

    // ---- helpers -----------------------------------------------------------

    private Cookie[] loginCookies() throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"student@campuscore.edu\",\"password\":\""
                                + PASSWORD + "\"}"))
                .andExpect(status().isOk())
                .andReturn();
        return result.getResponse().getCookies();
    }

    private Cookie login() throws Exception {
        Cookie access = java.util.Arrays.stream(loginCookies())
                .filter(cookie -> cookie.getName().equals("cc_access_token")).findFirst().orElse(null);
        assertThat(access).as("login must issue the central session cookie").isNotNull();
        return access;
    }

    private String authorize(Cookie access, String verifier, String nonce) throws Exception {
        MvcResult redirect = mvc.perform(get("/oauth2/authorize")
                        .cookie(access)
                        .queryParam("response_type", "code")
                        .queryParam("client_id", CLIENT)
                        .queryParam("redirect_uri", CALLBACK)
                        .queryParam("scope", "openid")
                        .queryParam("state", "s")
                        .queryParam("nonce", nonce)
                        .queryParam("code_challenge", pkceChallenge(verifier))
                        .queryParam("code_challenge_method", "S256"))
                .andExpect(status().is3xxRedirection())
                .andReturn();
        return queryParam(redirect.getResponse().getHeader("Location"), "code");
    }

    private org.springframework.test.web.servlet.ResultActions exchange(
            String code, String verifier) throws Exception {
        return mvc.perform(post("/oauth2/token")
                .with(httpBasic(CLIENT, SECRET))
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .param("grant_type", "authorization_code")
                .param("code", code)
                .param("redirect_uri", CALLBACK)
                .param("code_verifier", verifier));
    }

    private JsonNode exchangeCode(Cookie access, String verifier, String nonce) throws Exception {
        String code = authorize(access, verifier, nonce);
        MvcResult token = exchange(code, verifier)
                .andExpect(status().isOk())
                .andReturn();
        return mapper.readTree(token.getResponse().getContentAsString());
    }

    private static String queryParam(String location, String name) {
        for (String pair : location.substring(location.indexOf('?') + 1).split("&")) {
            String[] kv = pair.split("=", 2);
            if (kv[0].equals(name)) {
                return URLDecoder.decode(kv[1], StandardCharsets.UTF_8);
            }
        }
        return null;
    }

    private static String pkceVerifier() {
        byte[] bytes = new byte[32];
        new java.security.SecureRandom().nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String pkceChallenge(String verifier) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(verifier.getBytes(StandardCharsets.US_ASCII));
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
    }

    private static RSAKey localRing() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair pair = generator.generateKeyPair();
        return new RSAKey.Builder((RSAPublicKey) pair.getPublic())
                .privateKey((RSAPrivateKey) pair.getPrivate())
                .keyID("it-kid")
                .build();
    }

    private static String sign(RSAKey key, JWTClaimsSet claims) throws Exception {
        SignedJWT jwt = new SignedJWT(
                new com.nimbusds.jose.JWSHeader.Builder(com.nimbusds.jose.JWSAlgorithm.RS256)
                        .keyID(key.getKeyID())
                        .build(),
                claims);
        jwt.sign(new com.nimbusds.jose.crypto.RSASSASigner(key.toRSAPrivateKey()));
        return jwt.serialize();
    }
}
