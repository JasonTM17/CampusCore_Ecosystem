package io.campuscore.restfulapi.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.JWTParser;
import io.campuscore.restfulapi.mail.service.EmailService;
import io.campuscore.restfulapi.testsupport.CurrentAccountJwt;
import jakarta.servlet.http.Cookie;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextImpl;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * The native {@code cu-mobile} public client signs in through the issuer's
 * authorization-code + PKCE lane: {@code /oauth2/authorize} bounces an
 * anonymous browser to the issuer login page, which drives
 * {@code /api/v1/auth/login} and, for accounts with the email OTP switch on,
 * {@code /api/v1/auth/two-factor/verify}. The authorize endpoint only
 * recognises the central session cookie, so the second factor is enforced
 * exactly when no cookie (and no code, and no token) exists before the OTP is
 * verified. Every step below drives the real HTTP surface on H2; the mail
 * sender is mocked only to read the emailed code.
 */
@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
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
class MobileOidcTwoFactorFlowTest {

    private static final String ISSUER = "http://127.0.0.1:4010";
    private static final String CLIENT = "cu-mobile";
    private static final String REDIRECT = "campuscore://auth/callback";
    private static final String USER_ID = "student-user";
    private static final String EMAIL = "student@campuscore.edu";
    private static final String PASSWORD = "it-identity-password-2fa";
    private static final String ACCESS_COOKIE = "cc_access_token";
    private static final String REFRESH_COOKIE = "cc_refresh_token";

    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper mapper;
    @Autowired private PasswordEncoder passwordEncoder;
    @MockitoBean private EmailService emailService;

    private final JdbcTemplate jdbc;

    MobileOidcTwoFactorFlowTest(@Autowired javax.sql.DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    @BeforeEach
    void resetAccount() {
        jdbc.update(
                "UPDATE campuscore_auth.\"User\" SET \"password\" = ?, \"status\" = 'ACTIVE',"
                        + " \"mustChangePassword\" = FALSE, \"twoFactorEnabled\" = FALSE,"
                        + " \"failedLoginAttempts\" = 0, \"lockedUntil\" = NULL WHERE \"id\" = ?",
                passwordEncoder.encode(PASSWORD), USER_ID);
        jdbc.update("DELETE FROM campuscore_auth.\"TwoFactorChallenge\" WHERE \"userId\" = ?", USER_ID);
        jdbc.update("DELETE FROM campuscore_identity.oauth2_authorization WHERE principal_name = ?",
                USER_ID);
        reset(emailService);
    }

    @AfterEach
    void restoreSingleStepLogin() {
        // The H2 database is shared with other identity test contexts; leave
        // the seeded account in the single-step shape they expect.
        jdbc.update("UPDATE campuscore_auth.\"User\" SET \"twoFactorEnabled\" = FALSE,"
                        + " \"status\" = 'ACTIVE', \"mustChangePassword\" = FALSE, \"password\" = ?"
                        + " WHERE \"id\" = ?", passwordEncoder.encode(PASSWORD), USER_ID);
        jdbc.update("DELETE FROM campuscore_auth.\"TwoFactorChallenge\" WHERE \"userId\" = ?", USER_ID);
    }

    @Test
    void twoFactorAccountGetsNoCodeOrTokenUntilTheEmailedCodeIsVerified() throws Exception {
        enableTwoFactor();
        String verifier = pkceVerifier();

        // Anonymous authorize: bounced to the issuer login page, no code.
        MvcResult anonymous = authorize(null, verifier, "nonce-2fa");
        assertThat(anonymous.getResponse().getStatus()).isEqualTo(302);
        String loginLocation = anonymous.getResponse().getHeader("Location");
        assertThat(loginLocation).startsWith("/login?return=");
        assertThat(URLDecoder.decode(loginLocation, StandardCharsets.UTF_8))
                .contains("/oauth2/authorize?");
        assertNoCodeIssued(anonymous);

        // Password step: a challenge, never a session.
        String challengeId = passwordStepChallenge();
        assertNoGrantRow();

        // Neither the missing cookie nor the challenge id passes authorize.
        assertNoCodeIssued(authorize(null, verifier, "nonce-2fa"));
        assertNoCodeIssued(authorize(new Cookie(ACCESS_COOKIE, challengeId), verifier, "nonce-2fa"));
        assertNoGrantRow();

        // Wrong OTP: rejected, still no session.
        String code = latestCode();
        verifyOtp(challengeId, differentCode(code))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("TWO_FACTOR_CODE_INVALID"))
                .andExpect(cookie().doesNotExist(ACCESS_COOKIE))
                .andExpect(cookie().doesNotExist(REFRESH_COOKIE));
        assertNoGrantRow();

        // Correct OTP: the central session cookie is issued.
        MvcResult verified = verifyOtp(challengeId, code)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.id").value(USER_ID))
                .andReturn();
        Cookie access = verified.getResponse().getCookie(ACCESS_COOKIE);
        assertThat(access).as("verify must issue the central session cookie").isNotNull();

        // Replayed OTP: the consumed challenge never mints a second session.
        verifyOtp(challengeId, code)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("TWO_FACTOR_CHALLENGE_INVALID"))
                .andExpect(cookie().doesNotExist(ACCESS_COOKIE))
                .andExpect(cookie().doesNotExist(REFRESH_COOKIE));

        // Only now does authorize hand the app a code, and PKCE redeems it.
        String authorizationCode = codeFrom(authorize(access, verifier, "nonce-2fa"));
        JsonNode tokens = exchange(authorizationCode, verifier)
                .andExpect(status().isOk())
                .andReturn()
                .getResponse().getContentAsString().transform(this::json);
        JWTClaimsSet accessClaims = JWTParser.parse(tokens.get("access_token").asText())
                .getJWTClaimsSet();
        assertThat(accessClaims.getIssuer()).isEqualTo(ISSUER);
        assertThat(accessClaims.getSubject()).isEqualTo(USER_ID);
        assertThat(accessClaims.getAudience()).contains(CLIENT);
        assertThat(tokens.get("refresh_token")).isNotNull();
        JWTClaimsSet idClaims = JWTParser.parse(tokens.get("id_token").asText()).getJWTClaimsSet();
        assertThat(idClaims.getStringClaim("nonce")).isEqualTo("nonce-2fa");

        // A redeemed authorization code is single use.
        exchange(authorizationCode, verifier)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("invalid_grant"))
                .andExpect(jsonPath("$.access_token").doesNotExist());
    }

    @Test
    void expiredOtpNeverYieldsASessionOrACode() throws Exception {
        enableTwoFactor();
        String challengeId = passwordStepChallenge();
        String code = latestCode();
        jdbc.update("UPDATE campuscore_auth.\"TwoFactorChallenge\""
                + " SET \"expiresAt\" = now() - INTERVAL '11' MINUTE WHERE \"id\" = ?", challengeId);

        verifyOtp(challengeId, code)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("TWO_FACTOR_CODE_EXPIRED"))
                .andExpect(cookie().doesNotExist(ACCESS_COOKIE))
                .andExpect(cookie().doesNotExist(REFRESH_COOKIE));
        assertNoCodeIssued(authorize(null, pkceVerifier(), "nonce-expired"));
        assertNoGrantRow();
    }

    @Test
    void wrongPkceVerifierCannotRedeemACodeObtainedAfterTheSecondFactor() throws Exception {
        enableTwoFactor();
        Cookie access = completeTwoFactorLogin();
        String verifier = pkceVerifier();
        String authorizationCode = codeFrom(authorize(access, verifier, "nonce-pkce"));

        exchange(authorizationCode, pkceVerifier())
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("invalid_grant"))
                .andExpect(jsonPath("$.access_token").doesNotExist())
                .andExpect(jsonPath("$.refresh_token").doesNotExist());
    }

    @Test
    void sessionMintedBeforeTwoFactorWasEnabledCannotAuthorizeAfterwards() throws Exception {
        // Signed in while the switch was off, then enabled 2FA through the
        // real enable/confirm flow (which advances the credential revision).
        MvcResult passwordOnly = passwordStep().andExpect(status().isOk()).andReturn();
        Cookie preEnable = passwordOnly.getResponse().getCookie(ACCESS_COOKIE);
        String legacyRefresh = passwordOnly.getResponse().getCookie(REFRESH_COOKIE).getValue();
        String verifier = pkceVerifier();
        JsonNode priorTokens = json(exchange(codeFrom(authorize(preEnable, verifier, "nonce-before-enable")),
                verifier).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        String pendingVerifier = pkceVerifier();
        String pendingCode = codeFrom(authorize(preEnable, pendingVerifier, "nonce-pending-enable"));
        MvcResult enable = mvc.perform(post("/api/v1/me/two-factor/enable")
                        .with(CurrentAccountJwt.currentJwt(jdbc, USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isOk())
                .andReturn();
        String enableChallenge = json(enable.getResponse().getContentAsString())
                .path("challengeId").asText();
        mvc.perform(post("/api/v1/me/two-factor/confirm")
                        .with(CurrentAccountJwt.currentJwt(jdbc, USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"challengeId\":\"" + enableChallenge
                                + "\",\"code\":\"" + latestCode() + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(true));

        // A superseded cookie must restart authentication, never escape as
        // a servlet exception / HTTP 500 or silently authenticate without OTP.
        MvcResult stale = authorize(preEnable, pkceVerifier(), "nonce-stale");
        assertThat(stale.getResponse().getStatus()).isEqualTo(302);
        assertThat(stale.getResponse().getHeader("Location")).startsWith(REDIRECT + "?");
        assertThat(queryParam(stale.getResponse().getHeader("Location"), "error"))
                .isEqualTo("login_required");
        assertNoCodeIssued(stale);
        assertNoGrantRow();

        // Enrollment revoked every other password-only session and pending
        // grant. Neither refresh family nor a previously issued code can
        // turn that old authentication into a current, OTP-complete login.
        exchange(pendingCode, pendingVerifier).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("invalid_grant"));
        mvc.perform(post("/oauth2/token").contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("client_id", CLIENT).param("grant_type", "refresh_token")
                        .param("refresh_token", priorTokens.path("refresh_token").asText()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("invalid_grant"));
        mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("refreshToken", legacyRefresh))))
                .andExpect(status().isUnauthorized())
                .andExpect(cookie().doesNotExist(ACCESS_COOKIE));

        // The next sign-in must clear the second factor again.
        passwordStepChallenge();
    }

    @Test
    void supersededCredentialCookieReturnsLoginRequiredWithoutInternalDetails() throws Exception {
        Cookie stale = singleStepLogin();
        jdbc.update("UPDATE campuscore_auth.\"User\" SET \"credentialVersion\" = \"credentialVersion\" + 1"
                + " WHERE \"id\" = ?", USER_ID);
        MvcResult result = authorize(stale, pkceVerifier(), "nonce-revision");
        assertThat(result.getResponse().getStatus()).isEqualTo(302);
        String location = result.getResponse().getHeader("Location");
        assertThat(location).startsWith(REDIRECT + "?");
        assertThat(queryParam(location, "error")).isEqualTo("login_required");
        assertThat(queryParam(location, "state")).isEqualTo("s");
        assertThat(queryParam(location, "error_description")).isNull();
        assertThat(result.getResponse().getContentAsString()).isEmpty();
        assertNoCodeIssued(result);
        assertNoGrantRow();
    }

    @Test
    void passwordChangedCookieReturnsLoginRequired() throws Exception {
        Cookie stale = singleStepLogin();
        mvc.perform(post("/api/v1/auth/change-password")
                        .with(CurrentAccountJwt.currentJwt(jdbc, USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("oldPassword", PASSWORD,
                                "newPassword", "H-A-new-password-2026!"))))
                .andExpect(status().isOk());
        MvcResult result = authorize(stale, pkceVerifier(), "nonce-password-change");
        assertThat(result.getResponse().getStatus()).isEqualTo(302);
        String location = result.getResponse().getHeader("Location");
        assertThat(location).startsWith(REDIRECT + "?");
        assertThat(queryParam(location, "error")).isEqualTo("login_required");
        assertNoCodeIssued(result);
        assertNoGrantRow();
    }

    @Test
    void staleCredentialsNeverRedirectToAnUnregisteredCallback() throws Exception {
        Cookie stale = singleStepLogin();
        jdbc.update("UPDATE campuscore_auth.\"User\" SET \"credentialVersion\" = \"credentialVersion\" + 1"
                + " WHERE \"id\" = ?", USER_ID);
        mvc.perform(get("/oauth2/authorize").cookie(stale)
                        .queryParam("response_type", "code").queryParam("client_id", CLIENT)
                        .queryParam("redirect_uri", "https://unregistered.invalid/callback")
                        .queryParam("scope", "openid")
                        .queryParam("code_challenge", pkceChallenge(pkceVerifier()))
                        .queryParam("code_challenge_method", "S256"))
                .andExpect(status().isBadRequest())
                .andExpect(result -> assertThat(result.getResponse().getHeader("Location")).isNull());
        assertNoGrantRow();
    }

    @ParameterizedTest
    @ValueSource(strings = {"SUSPENDED", "LOCKED"})
    void inactiveCredentialCookieRestartsLogin(String status) throws Exception {
        Cookie stale = singleStepLogin();
        jdbc.update("UPDATE campuscore_auth.\"User\" SET \"status\" = ? WHERE \"id\" = ?", status, USER_ID);
        MvcResult result = authorize(stale, pkceVerifier(), "nonce-inactive");
        assertThat(result.getResponse().getStatus()).isEqualTo(302);
        assertThat(result.getResponse().getHeader("Location")).startsWith("/login?return=");
        assertNoCodeIssued(result);
        assertNoGrantRow();
    }

    @Test
    void deletedAccountCookieRestartsLogin() throws Exception {
        String deletedId = "ha-deleted-account";
        io.campuscore.restfulapi.testsupport.AccountAuthorityFixture.ensureUser(jdbc, deletedId);
        jdbc.update("UPDATE campuscore_auth.\"User\" SET \"password\" = ? WHERE \"id\" = ?",
                passwordEncoder.encode(PASSWORD), deletedId);
        MvcResult login = mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("email", deletedId + "@fixture.invalid",
                                "password", PASSWORD))))
                .andExpect(status().isOk()).andReturn();
        Cookie stale = login.getResponse().getCookie(ACCESS_COOKIE);
        jdbc.update("DELETE FROM campuscore_auth.\"Session\" WHERE \"userId\" = ?", deletedId);
        jdbc.update("DELETE FROM campuscore_auth.\"User\" WHERE \"id\" = ?", deletedId);
        MvcResult result = authorize(stale, pkceVerifier(), "nonce-deleted");
        assertThat(result.getResponse().getStatus()).isEqualTo(302);
        assertThat(result.getResponse().getHeader("Location")).startsWith("/login?return=");
        assertNoCodeIssued(result);
        assertNoGrantRow();
    }

    @Test
    void twoFactorChallengeCannotBeUsedAsRefreshOrPasswordGrant() throws Exception {
        enableTwoFactor();
        String challenge = passwordStepChallenge();
        exchange(challenge, pkceVerifier()).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("invalid_grant"))
                .andExpect(jsonPath("$.access_token").doesNotExist());
        mvc.perform(post("/oauth2/token").contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("client_id", CLIENT).param("grant_type", "refresh_token")
                        .param("refresh_token", challenge))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("invalid_grant"))
                .andExpect(jsonPath("$.access_token").doesNotExist());
        mvc.perform(post("/oauth2/token").contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("client_id", CLIENT).param("grant_type", "password")
                        .param("username", EMAIL).param("password", PASSWORD))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("unsupported_grant_type"))
                .andExpect(jsonPath("$.access_token").doesNotExist());
        mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("refreshToken", challenge))))
                .andExpect(status().isUnauthorized())
                .andExpect(cookie().doesNotExist(ACCESS_COOKIE));
        assertNoGrantRow();
    }

    @Test
    void servletSessionAndRememberMeCannotRestoreAnOtpIncompletePrincipal() throws Exception {
        enableTwoFactor();
        passwordStepChallenge();
        MockHttpSession session = new MockHttpSession();
        session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY,
                new SecurityContextImpl(UsernamePasswordAuthenticationToken.authenticated(
                        USER_ID, null, List.of())));
        MvcResult result = mvc.perform(get("/oauth2/authorize").session(session)
                        .cookie(new Cookie("remember-me", "untrusted-remembered-authentication"))
                        .queryParam("response_type", "code").queryParam("client_id", CLIENT)
                        .queryParam("redirect_uri", REDIRECT).queryParam("scope", "openid")
                        .queryParam("code_challenge", pkceChallenge(pkceVerifier()))
                        .queryParam("code_challenge_method", "S256"))
                .andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(302);
        assertThat(result.getResponse().getHeader("Location")).startsWith("/login?return=");
        assertNoCodeIssued(result);
        assertNoGrantRow();
    }

    @Test
    void refreshContinuesOnlyTheSessionEstablishedAfterOtp() throws Exception {
        enableTwoFactor();
        Cookie access = completeTwoFactorLogin();
        String verifier = pkceVerifier();
        String code = codeFrom(authorize(access, verifier, "nonce-refresh-2fa"));
        JsonNode tokens = json(exchange(code, verifier).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        mvc.perform(post("/oauth2/token").contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("client_id", CLIENT).param("grant_type", "refresh_token")
                        .param("refresh_token", tokens.path("refresh_token").asText()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.access_token").exists());
    }

    @Test
    void accountWithoutTwoFactorStillCompletesTheMobileFlow() throws Exception {
        Cookie access = singleStepLogin();
        String verifier = pkceVerifier();
        String authorizationCode = codeFrom(authorize(access, verifier, "nonce-plain"));
        exchange(authorizationCode, verifier)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.access_token").exists())
                .andExpect(jsonPath("$.refresh_token").exists())
                .andExpect(jsonPath("$.id_token").exists());
        verify(emailService, org.mockito.Mockito.never())
                .sendHtmlEmail(anyString(), anyString(), eq("two-factor-code"), org.mockito.ArgumentMatchers.anyMap());
    }

    // ---- helpers -----------------------------------------------------------

    private void enableTwoFactor() {
        jdbc.update("UPDATE campuscore_auth.\"User\" SET \"twoFactorEnabled\" = TRUE WHERE \"id\" = ?",
                USER_ID);
    }

    private org.springframework.test.web.servlet.ResultActions passwordStep() throws Exception {
        return mvc.perform(post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + EMAIL + "\",\"password\":\"" + PASSWORD + "\"}"));
    }

    private String passwordStepChallenge() throws Exception {
        MvcResult challenge = passwordStep()
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.twoFactorRequired").value(true))
                .andExpect(jsonPath("$.challengeId").exists())
                .andExpect(jsonPath("$.accessToken").doesNotExist())
                .andExpect(jsonPath("$.refreshToken").doesNotExist())
                .andExpect(cookie().doesNotExist(ACCESS_COOKIE))
                .andExpect(cookie().doesNotExist(REFRESH_COOKIE))
                .andReturn();
        return json(challenge.getResponse().getContentAsString()).path("challengeId").asText();
    }

    private Cookie singleStepLogin() throws Exception {
        MvcResult result = passwordStep()
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.twoFactorRequired").doesNotExist())
                .andReturn();
        Cookie access = result.getResponse().getCookie(ACCESS_COOKIE);
        assertThat(access).as("single-step login must issue the central session cookie").isNotNull();
        return access;
    }

    private Cookie completeTwoFactorLogin() throws Exception {
        String challengeId = passwordStepChallenge();
        MvcResult verified = verifyOtp(challengeId, latestCode())
                .andExpect(status().isOk())
                .andReturn();
        Cookie access = verified.getResponse().getCookie(ACCESS_COOKIE);
        assertThat(access).isNotNull();
        return access;
    }

    private org.springframework.test.web.servlet.ResultActions verifyOtp(String challengeId, String code)
            throws Exception {
        return mvc.perform(post("/api/v1/auth/two-factor/verify")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"challengeId\":\"" + challengeId + "\",\"code\":\"" + code + "\"}"));
    }

    private MvcResult authorize(Cookie access, String verifier, String nonce) throws Exception {
        var request = get("/oauth2/authorize")
                .queryParam("response_type", "code")
                .queryParam("client_id", CLIENT)
                .queryParam("redirect_uri", REDIRECT)
                .queryParam("scope", "openid profile email offline_access")
                .queryParam("state", "s")
                .queryParam("nonce", nonce)
                .queryParam("code_challenge", pkceChallenge(verifier))
                .queryParam("code_challenge_method", "S256");
        if (access != null) {
            request.cookie(access);
        }
        return mvc.perform(request).andReturn();
    }

    private org.springframework.test.web.servlet.ResultActions exchange(String code, String verifier)
            throws Exception {
        return mvc.perform(post("/oauth2/token")
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .param("grant_type", "authorization_code")
                .param("client_id", CLIENT)
                .param("code", code)
                .param("redirect_uri", REDIRECT)
                .param("code_verifier", verifier));
    }

    private static String codeFrom(MvcResult authorize) {
        assertThat(authorize.getResponse().getStatus()).isEqualTo(302);
        String location = authorize.getResponse().getHeader("Location");
        assertThat(location).startsWith(REDIRECT);
        String code = queryParam(location, "code");
        assertThat(code).as("authorize must return an authorization code").isNotBlank();
        return code;
    }

    /** Whatever the rejection shape (login bounce, error redirect, 4xx), no code reaches the app. */
    private static void assertNoCodeIssued(MvcResult authorize) {
        int status = authorize.getResponse().getStatus();
        String location = authorize.getResponse().getHeader("Location");
        if (status >= 300 && status < 400) {
            assertThat(location).isNotNull();
            if (location.startsWith(REDIRECT)) {
                assertThat(queryParam(location, "code")).isNull();
                assertThat(queryParam(location, "error")).isNotBlank();
            } else {
                assertThat(location).startsWith("/login?return=");
            }
        } else {
            assertThat(status).isBetween(400, 499);
        }
    }

    private void assertNoGrantRow() {
        Integer grants = jdbc.queryForObject(
                "SELECT COUNT(*) FROM campuscore_identity.oauth2_authorization WHERE principal_name = ?",
                Integer.class, USER_ID);
        assertThat(grants).as("no OIDC grant may exist before the second factor").isZero();
    }

    /** Reads the code handed to the mocked mail sender; never printed. */
    @SuppressWarnings("unchecked")
    private String latestCode() {
        ArgumentCaptor<Map<String, Object>> variables = ArgumentCaptor.forClass(Map.class);
        verify(emailService, atLeastOnce()).sendHtmlEmail(
                anyString(), anyString(), eq("two-factor-code"), variables.capture());
        List<Map<String, Object>> all = variables.getAllValues();
        Object code = all.get(all.size() - 1).get("code");
        assertThat(code).as("the mail variables must carry the code").isNotNull();
        return code.toString();
    }

    private static String differentCode(String code) {
        return code.equals("000000") ? "000001" : "000000";
    }

    private JsonNode json(String body) {
        return mapper.readTree(body);
    }

    private static String queryParam(String location, String name) {
        int query = location.indexOf('?');
        if (query < 0) {
            return null;
        }
        for (String pair : location.substring(query + 1).split("&")) {
            String[] kv = pair.split("=", 2);
            if (kv[0].equals(name) && kv.length == 2) {
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
