package io.campuscore.restfulapi.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.JWTParser;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * KM-3 probe (docs/ecosystem/mobile-policy.md §8 {@code mobile-oidc-probe}):
 * proves the {@code cu-mobile} public client ({@code ClientAuthenticationMethod
 * .NONE}) can run the full native OIDC contract with {@code client_id} only —
 * authorization-code+PKCE exchange, refresh-token grant, and token
 * revocation — before the mobile logout design commits to those semantics.
 * Also pins the {@code IdentityAccountGateFilter} skip for client-auth
 * principals on {@code /oauth2/token} (the filter only intercepts
 * JwtAuthenticationToken) and rotation reuse-detection for the native lane.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "identity.oidc.enabled=true",
        "identity.oidc.dev-keygen=true",
        "identity.oidc.issuer-uri=http://127.0.0.1:4010",
        "identity.oidc.token-encryption-key=dGVzdC1rZXktMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY=",
        "identity.clients[0].client-id=cu-mobile",
        "identity.clients[0].public-client=true",
        "identity.clients[0].redirect-uris[0]=campuscore://auth/callback",
        "identity.clients[0].scopes[0]=openid",
        "identity.clients[0].scopes[1]=profile",
        "identity.clients[0].scopes[2]=email",
        "identity.clients[0].scopes[3]=offline_access",
        "identity.clients[0].access-token-ttl=PT15M",
        "identity.clients[0].refresh-token-ttl=P7D",
        "identity.oidc.native-refresh-client-ids[0]=cu-mobile"
})
class MobileOidcPublicClientProbeTest {

    private static final String ISSUER = "http://127.0.0.1:4010";
    private static final String CLIENT = "cu-mobile";
    private static final String REDIRECT = "campuscore://auth/callback";
    private static final String PASSWORD = "it-identity-password-1";

    @Autowired private MockMvc mvc;
    private final JdbcTemplate jdbc;

    MobileOidcPublicClientProbeTest(@Autowired javax.sql.DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }
    @Autowired private ObjectMapper mapper;
    @Autowired private PasswordEncoder passwordEncoder;

    @BeforeEach
    void resetDemoAccount() {
        jdbc.update(
                "UPDATE campuscore_auth.\"User\" SET \"password\" = ?, \"status\" = 'ACTIVE',"
                        + " \"mustChangePassword\" = FALSE WHERE \"id\" = 'student-user'",
                passwordEncoder.encode(PASSWORD));
    }

    // ---- probe 1: client_id-only authorization_code+PKCE exchange ----------

    @Test
    void publicClientExchangesCodePkceWithClientIdOnly() throws Exception {
        Cookie access = login();
        String verifier = pkceVerifier();
        String code = authorize(access, verifier, "nonce-p1");

        // No httpBasic, no secret: the public client authenticates with the
        // client_id form parameter alone (PublicClientAuthenticationConverter).
        MvcResult token = mvc.perform(post("/oauth2/token")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("grant_type", "authorization_code")
                        .param("client_id", CLIENT)
                        .param("code", code)
                        .param("redirect_uri", REDIRECT)
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
        assertThat((List<Object>) accessClaims.getClaim("roles")).contains("STUDENT");

        JWTClaimsSet idClaims = JWTParser.parse(body.get("id_token").asText())
                .getJWTClaimsSet();
        assertThat(idClaims.getStringClaim("nonce")).isEqualTo("nonce-p1");
        assertThat(idClaims.getAudience()).contains(CLIENT);
    }

    @Test
    void publicClientExchangeWithoutPkceIsRejected() throws Exception {
        Cookie access = login();
        String code = authorize(access, pkceVerifier(), "nonce-p2");
        // requireProofKey(true) is set for every client (buildClient): a
        // public client skipping the verifier fails closed — the native
        // converter identifies the client, but the stock
        // PublicClientAuthenticationProvider's authenticateRequired throws
        // invalid_grant before any token is minted.
        mvc.perform(post("/oauth2/token")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("grant_type", "authorization_code")
                        .param("client_id", CLIENT)
                        .param("code", code)
                        .param("redirect_uri", REDIRECT))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("invalid_grant"));
    }

    // ---- probe 2: client_id-only refresh_token grant -----------------------

    @Test
    void publicClientRefreshGrantAcceptsClientIdOnly() throws Exception {
        JsonNode tokens = mintedSession();
        String oldRefresh = tokens.get("refresh_token").asText();

        MvcResult rotated = mvc.perform(post("/oauth2/token")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("grant_type", "refresh_token")
                        .param("client_id", CLIENT)
                        .param("refresh_token", oldRefresh))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(rotated.getResponse().getStatus()).isEqualTo(200);
        JsonNode body = mapper.readTree(rotated.getResponse().getContentAsString());
        assertThat(body.get("access_token")).isNotNull();
        assertThat(body.get("refresh_token")).isNotNull();
        assertThat(body.get("refresh_token").asText()).isNotEqualTo(oldRefresh);

        // reuseRefreshTokens(false) = rotation: the burned token must be
        // rejected on re-presentation (replay/reuse detection bridge §2.3).
        mvc.perform(post("/oauth2/token")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("grant_type", "refresh_token")
                        .param("client_id", CLIENT)
                        .param("refresh_token", oldRefresh))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("invalid_grant"));
    }

    // ---- probe 3: client_id-only revocation --------------------------------

    @Test
    void publicClientRevocationAcceptsClientIdOnly() throws Exception {
        JsonNode tokens = mintedSession();
        String refresh = tokens.get("refresh_token").asText();

        mvc.perform(post("/oauth2/revoke")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("token", refresh)
                        .param("client_id", CLIENT))
                .andExpect(status().isOk());

        // Revocation is real: the token can no longer refresh a session.
        mvc.perform(post("/oauth2/token")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("grant_type", "refresh_token")
                        .param("client_id", CLIENT)
                        .param("refresh_token", refresh))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("invalid_grant"));
    }

    @Test
    void revocationIsIdempotentForUnknownOrRevokedToken() throws Exception {
        // RFC 7009: revoking a second time (logout retried after a flaky
        // network) must still answer 200 — the mobile logout lane relies on
        // idempotence for its best-effort revoke step.
        JsonNode tokens = mintedSession();
        String refresh = tokens.get("refresh_token").asText();
        for (int i = 0; i < 2; i++) {
            mvc.perform(post("/oauth2/revoke")
                            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                            .param("token", refresh)
                            .param("client_id", CLIENT))
                    .andExpect(status().isOk());
        }
        mvc.perform(post("/oauth2/revoke")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("token", "not-a-real-token")
                        .param("client_id", CLIENT))
                .andExpect(status().isOk());
    }

    // ---- probe 4: gate filter skips client-auth principals ------------------

    @Test
    void suspendedAccountCannotExtendASessionViaRefresh() throws Exception {
        // IdentityAccountGateFilter only intercepts JwtAuthenticationToken —
        // but the stronger guarantee lives one layer down: the refresh grant
        // re-saves the authorization and LockingIdentityAuthorizationService
        // .assertCurrentCredentials refuses any save for a non-ACTIVE or
        // password-rotation account. A suspended user's mobile refresh token
        // therefore dies immediately (bridge §2.3) instead of surviving until
        // the next bearer-lane check.
        JsonNode tokens = mintedSession();
        jdbc.update("UPDATE campuscore_auth.\"User\" SET \"status\" = 'SUSPENDED'"
                + " WHERE \"id\" = 'student-user'");
        mvc.perform(post("/oauth2/token")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("grant_type", "refresh_token")
                        .param("client_id", CLIENT)
                        .param("refresh_token", tokens.get("refresh_token").asText()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());
    }

    @Test
    void mustChangePasswordAccountCannotRefresh() throws Exception {
        // Same freshness gate for the rotation-pending flag — a temporary
        // password account cannot keep a native session alive.
        JsonNode tokens = mintedSession();
        jdbc.update("UPDATE campuscore_auth.\"User\" SET \"mustChangePassword\" = TRUE"
                + " WHERE \"id\" = 'student-user'");
        mvc.perform(post("/oauth2/token")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("grant_type", "refresh_token")
                        .param("client_id", CLIENT)
                        .param("refresh_token", tokens.get("refresh_token").asText()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());
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

    private JsonNode mintedSession() throws Exception {
        Cookie access = login();
        String verifier = pkceVerifier();
        String code = authorize(access, verifier, "nonce-mint");
        MvcResult token = mvc.perform(post("/oauth2/token")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("grant_type", "authorization_code")
                        .param("client_id", CLIENT)
                        .param("code", code)
                        .param("redirect_uri", REDIRECT)
                        .param("code_verifier", verifier))
                .andExpect(status().isOk())
                .andReturn();
        return mapper.readTree(token.getResponse().getContentAsString());
    }

    private String authorize(Cookie access, String verifier, String nonce) throws Exception {
        MvcResult redirect = mvc.perform(get("/oauth2/authorize")
                        .cookie(access)
                        .queryParam("response_type", "code")
                        .queryParam("client_id", CLIENT)
                        .queryParam("redirect_uri", REDIRECT)
                        .queryParam("scope", "openid profile email offline_access")
                        .queryParam("state", "s")
                        .queryParam("nonce", nonce)
                        .queryParam("code_challenge", pkceChallenge(verifier))
                        .queryParam("code_challenge_method", "S256"))
                .andExpect(status().is3xxRedirection())
                .andReturn();
        String location = redirect.getResponse().getHeader("Location");
        assertThat(location).startsWith(REDIRECT);
        return queryParam(location, "code");
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
}
