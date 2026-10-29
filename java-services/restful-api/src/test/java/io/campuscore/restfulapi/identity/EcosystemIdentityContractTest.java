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
@AutoConfigureMockMvc
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
        String stored = jdbc.queryForObject(
                "SELECT refresh_token_value FROM campuscore_identity.oauth2_authorization"
                        + " WHERE principal_name = 'student-user'",
                String.class);
        assertThat(stored).isNotNull();
        assertThat(stored).doesNotContain(rawRefresh);
        // Round-trip through the same deterministic AEAD proves it is the
        // ciphertext of the presented token, not a lossy transform.
        DeterministicTokenCipher cipher = new DeterministicTokenCipher(
                "dGVzdC1rZXktMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY=");
        assertThat(cipher.decrypt(stored, LockingIdentityAuthorizationService.TOKEN_AAD))
                .isEqualTo(rawRefresh);
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

    // ---- helpers -----------------------------------------------------------

    private Cookie login() throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"student@campuscore.edu\",\"password\":\""
                                + PASSWORD + "\"}"))
                .andExpect(status().isOk())
                .andReturn();
        Cookie access = result.getResponse().getCookie("cc_access_token");
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
