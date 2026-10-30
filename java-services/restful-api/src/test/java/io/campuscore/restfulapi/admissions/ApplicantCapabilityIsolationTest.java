package io.campuscore.restfulapi.admissions;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.campuscore.restfulapi.auth.repository.AuthUserRepository;
import io.campuscore.restfulapi.identity.IdentityTokenCustomizer;
import io.campuscore.restfulapi.security.AuthPrincipal;
import io.campuscore.restfulapi.security.AuthTokenService;
import io.campuscore.restfulapi.testsupport.CurrentAccountJwt;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.authorization.OAuth2TokenType;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.context.AuthorizationServerContext;
import org.springframework.security.oauth2.server.authorization.settings.AuthorizationServerSettings;
import org.springframework.security.oauth2.server.authorization.token.JwtEncodingContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.ObjectMapper;

/**
 * Isolation contract for a roleless-but-authenticated applicant account.
 *
 * <p>The applicant session is expressed by the additive access-token
 * {@code capabilities} claim ({@code admissions:self}) that both token
 * issuers mint for every grant-eligible (ACTIVE) account. It confers no
 * academic role, no permission and no grant; the resource server keeps
 * owner-scoping SELF admissions by {@code jwt.sub} and keeps denying every
 * role-gated surface exactly as before. These tests pin both halves: the
 * claim contract at the issuers, and the owner-scoped isolation plus the
 * role-gate negatives on the real controllers over H2.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:applicant_capability;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
})
class ApplicantCapabilityIsolationTest {

    private static final String CYCLE = "2026-Q1-DEMO";
    private static final List<String> ADMISSIONS_SELF = List.of("admissions:self");

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private AuthTokenService tokenService;

    @Autowired
    @Qualifier("jwtDecoder")
    private JwtDecoder accessTokenDecoder;

    /** Applicant session token: authenticated, zero roles, the SELF grant. */
    private RequestPostProcessor applicantJwt;
    private RequestPostProcessor applicant2Jwt;
    private RequestPostProcessor adminJwt;

    @BeforeEach
    void fixture() throws Exception {
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS campuscore_auth");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS notifications");
        jdbc.execute("DROP SCHEMA IF EXISTS admissions CASCADE");
        jdbc.execute("DROP TABLE IF EXISTS notifications.notification");
        jdbc.execute("CREATE SCHEMA IF NOT EXISTS admissions");
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS notifications.notification (
                    id VARCHAR(120) PRIMARY KEY,
                    user_id VARCHAR(120) NOT NULL,
                    title VARCHAR(240) NOT NULL,
                    message VARCHAR(2000) NOT NULL,
                    type VARCHAR(60) NOT NULL,
                    link VARCHAR(500),
                    is_read BOOLEAN NOT NULL DEFAULT FALSE,
                    read_at TIMESTAMP WITH TIME ZONE,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
                )""");
        try (java.sql.Connection connection = jdbc.getDataSource().getConnection()) {
            ScriptUtils.executeSqlScript(connection,
                    new ClassPathResource("db/migration-h2/V140__admissions_schema.sql"));
        }

        // The capability claim is presentation data for the client; resource
        // authorization never reads it — owner scoping runs off jwt.sub.
        applicantJwt = CurrentAccountJwt.fixtureJwt(jdbc, "applicant-only",
                token -> token.claim("capabilities", ADMISSIONS_SELF));
        applicant2Jwt = CurrentAccountJwt.fixtureJwt(jdbc, "applicant-only-2",
                token -> token.claim("capabilities", ADMISSIONS_SELF));
        adminJwt = CurrentAccountJwt.fixtureJwt(jdbc, "admin-user", "ADMIN");
        CurrentAccountJwt.fixtureJwt(jdbc, "staff-no-grant", "STUDENT");

        jdbc.update("DELETE FROM admissions.\"StaffGrant\"");
        jdbc.update("INSERT INTO admissions.\"StaffGrant\" (\"id\", \"userId\", \"scope\", \"grantedBy\")"
                + " VALUES ('g-1', 'staff-no-grant', 'admissions', 'admin-user')");
    }

    // ---------------------------------------------------------------
    // Token issuers — the additive claim contract
    // ---------------------------------------------------------------

    @Test
    void legacyAccessTokenCarriesAdmissionsSelfForActiveRolelessAccount() {
        Jwt decoded = accessTokenDecoder.decode(tokenService.issueAccessToken(new AuthPrincipal(
                "applicant-1", "applicant@campuscore.edu", "Applicant", "One",
                "ACTIVE", List.of(), List.of(), null, null, null, 0L)).accessToken());

        assertEquals("access", decoded.getClaimAsString("tokenType"));
        assertEquals(List.of(), decoded.getClaimAsStringList("roles"));
        assertEquals(ADMISSIONS_SELF, decoded.getClaimAsStringList("capabilities"));
    }

    @Test
    void legacyAccessTokenOmitsCapabilityForNonActiveAccount() {
        Jwt locked = accessTokenDecoder.decode(tokenService.issueAccessToken(new AuthPrincipal(
                "demo-applicant", "locked@campuscore.edu", "Demo", "Applicant",
                "LOCKED", List.of(), List.of(), null, null, null, 0L)).accessToken());
        assertNull(locked.getClaim("capabilities"));

        Jwt suspended = accessTokenDecoder.decode(tokenService.issueAccessToken(new AuthPrincipal(
                "suspended-1", "suspended@campuscore.edu", "Sus", "Pended",
                "SUSPENDED", List.of("STUDENT"), List.of(), null, null, null, 0L)).accessToken());
        assertNull(suspended.getClaim("capabilities"));
    }

    @Test
    void oidcCustomizerMintsCapabilityForActiveAccount() {
        AuthUserRepository repository = mock(AuthUserRepository.class);
        when(repository.findAccountAuthorization("applicant-1")).thenReturn(Optional.of(
                new AuthUserRepository.AccountAuthorization(
                        "ACTIVE", false, null, null, null, Set.of(), Set.of(), 0L)));

        JwtClaimsSet.Builder claims = JwtClaimsSet.builder();
        new IdentityTokenCustomizer(repository).customize(accessContext(claims, "applicant-1"));
        java.util.Map<String, Object> built = claims.build().getClaims();

        assertEquals(ADMISSIONS_SELF, built.get("capabilities"));
        assertEquals(List.of(), built.get("roles"));
    }

    @Test
    void oidcCustomizerSkipsCapabilityForNonActiveAccount() {
        AuthUserRepository repository = mock(AuthUserRepository.class);
        when(repository.findAccountAuthorization("locked-demo")).thenReturn(Optional.of(
                new AuthUserRepository.AccountAuthorization(
                        "LOCKED", false, null, null, null, Set.of(), Set.of(), 0L)));

        JwtClaimsSet.Builder claims = JwtClaimsSet.builder();
        new IdentityTokenCustomizer(repository).customize(accessContext(claims, "locked-demo"));

        assertThat(claims.build().getClaims()).doesNotContainKey("capabilities");
    }

    @Test
    void oidcCustomizerLeavesNonAccessTokensUntouched() {
        AuthUserRepository repository = mock(AuthUserRepository.class);
        JwtClaimsSet.Builder claims = JwtClaimsSet.builder().claim("seed", "x");
        JwtEncodingContext context = JwtEncodingContext.with(JwsHeader.with(MacAlgorithm.HS256), claims)
                .registeredClient(registeredClient())
                .principal(new UsernamePasswordAuthenticationToken("user-1", "n/a"))
                .authorizedScopes(Set.of("openid"))
                .tokenType(OAuth2TokenType.REFRESH_TOKEN)
                .authorizationGrantType(AuthorizationGrantType.REFRESH_TOKEN)
                .build();

        new IdentityTokenCustomizer(repository).customize(context);

        assertThat(claims.build().getClaims())
                .containsEntry("seed", "x")
                .doesNotContainKeys("capabilities", "roles", "permissions");
    }

    private static RegisteredClient registeredClient() {
        return RegisteredClient.withId("rc-1").clientId("client-1")
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri("https://client.test/callback")
                .scope("openid")
                .build();
    }

    private static JwtEncodingContext accessContext(JwtClaimsSet.Builder claims, String subject) {
        return JwtEncodingContext.with(JwsHeader.with(MacAlgorithm.HS256), claims)
                .registeredClient(registeredClient())
                .principal(new UsernamePasswordAuthenticationToken(subject, "n/a"))
                .authorizationServerContext(new AuthorizationServerContext() {
                    @Override
                    public String getIssuer() {
                        return "https://issuer.test";
                    }

                    @Override
                    public AuthorizationServerSettings getAuthorizationServerSettings() {
                        return AuthorizationServerSettings.builder().build();
                    }
                })
                .authorizedScopes(Set.of("openid"))
                .tokenType(OAuth2TokenType.ACCESS_TOKEN)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .build();
    }

    // ---------------------------------------------------------------
    // SELF surface — the applicant session works on its own records
    // ---------------------------------------------------------------

    @Test
    void rolelessApplicantCreatesListsAndReadsOwnApplication() throws Exception {
        MvcResult created = mvc.perform(post("/api/v1/admissions/applications")
                        .with(applicantJwt).header("Idempotency-Key", "appl-create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"cycle\":\"" + CYCLE + "\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.applicantUserId").value("applicant-only"))
                .andReturn();
        String id = objectMapper.readTree(created.getResponse().getContentAsString())
                .get("id").asText();

        mvc.perform(get("/api/v1/admissions/applications/my").with(applicantJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(id));

        mvc.perform(get("/api/v1/admissions/applications/" + id).with(applicantJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id));
    }

    @Test
    void rolelessApplicantCannotReadOrMutateAnotherApplicantsApplication() throws Exception {
        MvcResult created = mvc.perform(post("/api/v1/admissions/applications")
                        .with(applicantJwt).header("Idempotency-Key", "appl-own")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"cycle\":\"" + CYCLE + "\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        String id = objectMapper.readTree(created.getResponse().getContentAsString())
                .get("id").asText();

        mvc.perform(get("/api/v1/admissions/applications/" + id).with(applicant2Jwt))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));
        mvc.perform(post("/api/v1/admissions/applications/" + id + "/withdraw")
                        .with(applicant2Jwt).header("Idempotency-Key", "appl-wd")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":1}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));
    }

    // ---------------------------------------------------------------
    // Fail-closed negatives — the grant carries no academic or staff right
    // ---------------------------------------------------------------

    @Test
    void applicantIsDeniedAcademicAndStaffSurfaces() throws Exception {
        mvc.perform(get("/api/v1/enrollments/my").with(applicantJwt))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/me/registration/eligibility").with(applicantJwt))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/admissions/staff/queue").with(applicantJwt))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ADMISSIONS_STAFF_REQUIRED"));
    }

    @Test
    void adminGrantListingIsMetadataOnlyAndGrantsNoStaffLane() throws Exception {
        mvc.perform(get("/api/v1/admissions/staff/grants").with(adminJwt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.userId=='staff-no-grant' && @.scope=='admissions')].id")
                        .isNotEmpty());

        mvc.perform(get("/api/v1/admissions/staff/queue").with(adminJwt))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ADMISSIONS_STAFF_REQUIRED"));
    }

    @Test
    void lockedAccountRequestIsDeniedBeforeAnyCapabilityApplies() throws Exception {
        RequestPostProcessor lockedJwt = CurrentAccountJwt.fixtureJwt(jdbc, "locked-applicant",
                token -> token.claim("capabilities", ADMISSIONS_SELF));
        jdbc.update("UPDATE campuscore_auth.\"User\" SET \"status\"='LOCKED' WHERE \"id\"=?",
                "locked-applicant");

        mvc.perform(get("/api/v1/admissions/applications/my").with(lockedJwt))
                .andExpect(status().isForbidden());
    }
}
