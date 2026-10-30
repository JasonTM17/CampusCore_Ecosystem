package io.campuscore.restfulapi.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doCallRealMethod;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import io.campuscore.restfulapi.auth.service.AuthLoginService;
import jakarta.servlet.http.Cookie;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.server.authorization.OAuth2Authorization;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.OAuth2TokenType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Exercises the configured SAS endpoints with production migrations on disposable PostgreSQL. */
@EnabledIf("postgresTargetConfigured")
@SpringBootTest(properties = {
        "spring.flyway.locations=classpath:db/migration",
        "deepseek.enabled=false",
        "identity.oidc.enabled=true",
        "identity.oidc.dev-keygen=true",
        "identity.oidc.issuer-uri=http://127.0.0.1:4010",
        "identity.clients[0].client-id=refresh-web",
        "identity.clients[0].client-secret=${refresh-test.client-secret}",
        "identity.clients[0].redirect-uris[0]=http://127.0.0.1:3100/session/callback",
        "identity.clients[0].post-logout-redirect-uris[0]=http://127.0.0.1:3100/",
        "identity.clients[0].scopes[0]=openid",
        "identity.clients[1].client-id=refresh-native",
        "identity.clients[1].public-client=true",
        "identity.clients[1].redirect-uris[0]=campuscore://auth/callback",
        "identity.clients[1].scopes[0]=openid",
        "identity.clients[1].scopes[1]=offline_access",
        "identity.oidc.native-refresh-client-ids[0]=refresh-native"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@ActiveProfiles({"test", "persistence"})
class OidcRefreshConsumptionPostgresIT {

    private static final int WAIT_SECONDS = 20;
    private static final String CLIENT_SECRET = randomValue();
    private static final String ENCRYPTION_KEY = Base64.getEncoder().encodeToString(new SecureRandom().generateSeed(32));

    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper mapper;
    @Autowired private PasswordEncoder passwords;
    @Autowired private AuthLoginService login;
    @MockitoSpyBean private OAuth2AuthorizationService authorizations;
    @MockitoSpyBean private IdentitySessionMirror mirror;
    @MockitoSpyBean private UnifiedSessionAuthority authority;
    private final JdbcTemplate jdbc;

    OidcRefreshConsumptionPostgresIT(@Autowired javax.sql.DataSource dataSource) {
        jdbc = new JdbcTemplate(dataSource);
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("CAMPUSCORE_COUNCIL_POSTGRES_URL"));
        registry.add("spring.datasource.username", () -> System.getenv("CAMPUSCORE_COUNCIL_POSTGRES_USER"));
        registry.add("spring.datasource.password", () -> System.getenv("CAMPUSCORE_COUNCIL_POSTGRES_PASSWORD"));
        registry.add("refresh-test.client-secret", () -> CLIENT_SECRET);
        registry.add("identity.oidc.token-encryption-key", () -> ENCRYPTION_KEY);
    }

    @ParameterizedTest
    @ValueSource(strings = {"refresh-web", "refresh-native"})
    void sameRefreshGenerationIsConsumedExactlyOnce(String client) throws Exception {
        Session session = mint(client);
        long version = version(session.user());
        CountDownLatch firstLoaded = new CountDownLatch(1);
        CountDownLatch secondLoaded = new CountDownLatch(1);
        CountDownLatch releaseFirst = new CountDownLatch(1);
        CountDownLatch releaseSecond = new CountDownLatch(1);
        AtomicInteger lookups = new AtomicInteger();
        AtomicInteger replayCalls = new AtomicInteger();

        // Both requests have read the same committed generation before either
        // can consume it. Later under-lock re-reads are deliberately unpaused.
        doAnswer(call -> {
            Object result = call.callRealMethod();
            int ordinal = lookups.incrementAndGet();
            if (ordinal <= 2) {
                assertThat(result != null).as("initial refresh lookup found a live grant").isTrue();
                (ordinal == 1 ? firstLoaded : secondLoaded).countDown();
                await(ordinal == 1 ? releaseFirst : releaseSecond);
            }
            return result;
        }).when(authorizations).findByToken(eq(session.refresh()), eq(OAuth2TokenType.REFRESH_TOKEN));

        var pool = Executors.newFixedThreadPool(2);
        try {
            var first = pool.submit(() -> refresh(client, session.refresh()));
            await(firstLoaded);
            var second = pool.submit(() -> refresh(client, session.refresh()));
            await(secondLoaded);
            releaseFirst.countDown();
            MvcResult winner = first.get(WAIT_SECONDS, TimeUnit.SECONDS);
            assertStatus(winner, 200);
            String replacement = body(winner).path("refresh_token").asText();
            assertThat(!replacement.isBlank() && !replacement.equals(session.refresh()))
                    .as("winner issued a distinct refresh generation").isTrue();
            assertConsistent(session, replacement, 2);
            assertThat(mirror.refreshLineageState(session.refresh())).isEqualTo("USED");

            // Observe durable state immediately before the unchanged replay
            // policy revokes it. The loser must never replace the winner.
            doAnswer(call -> {
                replayCalls.incrementAndGet();
                assertConsistent(session, replacement, 2);
                assertThat(version(session.user())).isEqualTo(version);
                return call.callRealMethod();
            }).when(authority).revokeAccount(eq(session.user()), eq("OIDC"),
                    eq("REFRESH_REPLAY"), org.mockito.ArgumentMatchers.nullable(String.class));

            releaseSecond.countDown();
            MvcResult loser = second.get(WAIT_SECONDS, TimeUnit.SECONDS);
            assertStatus(loser, 400);
            assertThat(body(loser).path("error").asText()).isEqualTo("invalid_grant");
            assertThat(replayCalls.get()).isEqualTo(1);
            assertEmpty(session.user());
            assertThat(version(session.user())).isEqualTo(version + 1);
        } finally {
            releaseFirst.countDown();
            releaseSecond.countDown();
            pool.shutdownNow();
            assertThat(pool.awaitTermination(WAIT_SECONDS, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void replacementFailureRollsBackGrantMirrorAndLineageAndAllowsRetry() throws Exception {
        Session session = mint("refresh-native");
        doAnswer(call -> {
            call.callRealMethod();
            throw new IllegalStateException("injected refresh lineage fault");
        }).when(mirror).recordRefreshLineage(eq(session.grant()), eq(session.user()), anyString());

        assertThatThrownBy(() -> refresh(session.client(), session.refresh()))
                .hasStackTraceContaining("injected refresh lineage fault");
        assertConsistent(session, session.refresh(), 1);
        doCallRealMethod().when(mirror).recordRefreshLineage(
                eq(session.grant()), eq(session.user()), anyString());
        MvcResult retry = refresh(session.client(), session.refresh());
        assertStatus(retry, 200);
        assertConsistent(session, body(retry).path("refresh_token").asText(), 2);
    }

    @ParameterizedTest
    @ValueSource(strings = {"refresh-web", "refresh-native"})
    void clientLogoutAfterLookupPreventsRefreshResurrection(String client) throws Exception {
        Session session = mint(client);
        long version = version(session.user());
        CountDownLatch loaded = new CountDownLatch(1);
        CountDownLatch resume = new CountDownLatch(1);
        doAnswer(call -> {
            Object result = call.callRealMethod();
            loaded.countDown();
            await(resume);
            return result;
        }).when(authorizations).findByToken(eq(session.refresh()), eq(OAuth2TokenType.REFRESH_TOKEN));
        var pool = Executors.newSingleThreadExecutor();
        try {
            var refresh = pool.submit(() -> refresh(client, session.refresh()));
            await(loaded);
            authority.revokeClientGrants(session.user(), client, "OIDC_LOGOUT", null);
            resume.countDown();
            assertStatus(refresh.get(WAIT_SECONDS, TimeUnit.SECONDS), 400);
            assertThat(count("campuscore_identity.oauth2_authorization", "principal_name", session.user())).isZero();
            assertThat(count("campuscore_auth.\"Session\"", "\"authorizationId\"", session.grant())).isZero();
            assertThat(version(session.user())).isEqualTo(version);
            assertThat(count("campuscore_auth.\"Session\"", "\"userId\"", session.user()))
                    .as("client logout preserves the legacy login session").isEqualTo(1);
        } finally {
            resume.countDown();
            pool.shutdownNow();
            assertThat(pool.awaitTermination(WAIT_SECONDS, TimeUnit.SECONDS)).isTrue();
        }
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void publicCodeExchangeRequiresTheMatchingPkceVerifier(boolean wrongVerifier) throws Exception {
        User user = user();
        String verifier = randomValue();
        String code = authorize(user.cookie(), "refresh-native", verifier);
        var request = tokenRequest("refresh-native").param("grant_type", "authorization_code")
                .param("code", code).param("redirect_uri", callback("refresh-native"));
        if (wrongVerifier) {
            request.param("code_verifier", randomValue());
        }
        MvcResult rejected = mvc.perform(request).andReturn();
        assertStatus(rejected, 400);
        assertThat(body(rejected).path("error").asText()).isEqualTo("invalid_grant");
        assertThat(count("campuscore_auth.\"Session\"", "\"userId\"", user.id())).isEqualTo(1);
        assertThat(count("campuscore_identity.oidc_refresh_lineage", "user_id", user.id())).isZero();
    }

    @Test
    void anotherClientCannotConsumeALiveRefreshGeneration() throws Exception {
        Session session = mint("refresh-web");
        long version = version(session.user());
        MvcResult rejected = refresh("refresh-native", session.refresh());
        assertStatus(rejected, 400);
        assertThat(body(rejected).path("error").asText()).isEqualTo("invalid_grant");
        assertConsistent(session, session.refresh(), 1);
        assertThat(version(session.user())).isEqualTo(version);
    }

    @Test
    void unknownRefreshTokenDoesNotRevokeAnExistingAccount() throws Exception {
        Session session = mint("refresh-native");
        long version = version(session.user());
        MvcResult rejected = refresh(session.client(), randomValue());
        assertStatus(rejected, 400);
        assertThat(body(rejected).path("error").asText()).isEqualTo("invalid_grant");
        assertConsistent(session, session.refresh(), 1);
        assertThat(version(session.user())).isEqualTo(version);
    }

    private Session mint(String client) throws Exception {
        User user = user();
        String verifier = randomValue();
        String code = authorize(user.cookie(), client, verifier);
        MvcResult tokens = mvc.perform(tokenRequest(client).param("grant_type", "authorization_code")
                .param("code", code).param("redirect_uri", callback(client))
                .param("code_verifier", verifier)).andReturn();
        assertStatus(tokens, 200);
        String refresh = body(tokens).path("refresh_token").asText();
        assertThat(!refresh.isBlank()).as("code exchange issued a refresh token").isTrue();
        OAuth2Authorization grant = authorizations.findByToken(refresh, OAuth2TokenType.REFRESH_TOKEN);
        assertThat(grant != null).isTrue();
        return new Session(user.id(), client, grant.getId(), refresh);
    }

    private User user() {
        String suffix = UUID.randomUUID().toString();
        String user = "refresh-it-" + suffix;
        String email = suffix + "@refresh.invalid";
        String password = randomValue();
        jdbc.update("INSERT INTO campuscore_auth.\"User\""
                        + " (\"id\", \"email\", \"password\", \"firstName\", \"lastName\", \"status\","
                        + " \"emailVerified\", \"isSuperAdmin\", \"failedLoginAttempts\", \"createdAt\", \"updatedAt\")"
                        + " VALUES (?, ?, ?, 'Refresh', 'Test', 'ACTIVE', TRUE, FALSE, 0,"
                        + " CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                user, email, passwords.encode(password));
        String access = login.login(email, password, "127.0.0.1", "refresh-test").response().accessToken();
        return new User(user, new Cookie("cc_access_token", access));
    }

    private String authorize(Cookie cookie, String client, String verifier) throws Exception {
        String challenge = Base64.getUrlEncoder().withoutPadding().encodeToString(
                MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
        MvcResult result = mvc.perform(get("/oauth2/authorize").cookie(cookie)
                .queryParam("response_type", "code").queryParam("client_id", client)
                .queryParam("redirect_uri", callback(client))
                .queryParam("scope", client.equals("refresh-native") ? "openid offline_access" : "openid")
                .queryParam("state", "refresh-test").queryParam("nonce", "refresh-nonce")
                .queryParam("code_challenge", challenge).queryParam("code_challenge_method", "S256"))
                .andReturn();
        assertStatus(result, 302);
        String location = result.getResponse().getHeader("Location");
        assertThat(location != null && location.startsWith(callback(client) + "?"))
                .as("authorization redirected to the registered callback").isTrue();
        for (String part : URI.create(location).getRawQuery().split("&")) {
            if (part.startsWith("code=")) {
                return URLDecoder.decode(part.substring(5), StandardCharsets.UTF_8);
            }
        }
        throw new AssertionError("authorization did not issue a code");
    }

    private MockHttpServletRequestBuilder tokenRequest(String client) {
        var request = post("/oauth2/token").contentType(MediaType.APPLICATION_FORM_URLENCODED);
        return client.equals("refresh-native") ? request.param("client_id", client)
                : request.with(httpBasic(client, CLIENT_SECRET));
    }

    private MvcResult refresh(String client, String refresh) throws Exception {
        return mvc.perform(tokenRequest(client).param("grant_type", "refresh_token")
                .param("refresh_token", refresh)).andReturn();
    }

    private void assertConsistent(Session session, String expectedRefresh, int lineageCount) {
        OAuth2Authorization grant = authorizations.findById(session.grant());
        assertThat(grant != null).as("grant exists").isTrue();
        assertThat(Objects.equals(grant.getRefreshToken().getToken().getTokenValue(), expectedRefresh))
                .as("grant retains the expected generation").isTrue();
        String hash = IdentitySessionMirror.sha256Hex(expectedRefresh);
        String storedHash = jdbc.queryForObject("SELECT \"refreshToken\" FROM campuscore_auth.\"Session\""
                + " WHERE \"authorizationId\" = ?", String.class, session.grant());
        assertThat(Objects.equals(hash, storedHash)).as("mirror matches the grant generation").isTrue();
        String ciphertext = jdbc.queryForObject("SELECT refresh_token_value FROM"
                + " campuscore_identity.oauth2_authorization WHERE id = ?", String.class, session.grant());
        assertThat(ciphertext != null && !ciphertext.equals(expectedRefresh))
                .as("refresh token remains encrypted at rest").isTrue();
        assertThat(count("campuscore_identity.oauth2_authorization", "principal_name", session.user())).isEqualTo(1);
        assertThat(count("campuscore_auth.\"Session\"", "\"authorizationId\"", session.grant())).isEqualTo(1);
        assertThat(count("campuscore_identity.oidc_refresh_lineage", "user_id", session.user())).isEqualTo(lineageCount);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM campuscore_identity.oidc_refresh_lineage"
                + " WHERE authorization_id = ? AND state = 'LIVE'", Integer.class, session.grant())).isEqualTo(1);
        assertThat(mirror.refreshLineageState(expectedRefresh)).isEqualTo("LIVE");
    }

    private void assertEmpty(String user) {
        assertThat(count("campuscore_identity.oauth2_authorization", "principal_name", user)).isZero();
        assertThat(count("campuscore_auth.\"Session\"", "\"userId\"", user)).isZero();
        assertThat(count("campuscore_identity.oidc_refresh_lineage", "user_id", user)).isZero();
    }

    private int count(String table, String column, String value) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE " + column + " = ?", Integer.class, value);
    }

    private long version(String user) {
        return jdbc.queryForObject("SELECT \"credentialVersion\" FROM campuscore_auth.\"User\" WHERE \"id\" = ?",
                Long.class, user);
    }

    private JsonNode body(MvcResult result) throws Exception {
        return mapper.readTree(result.getResponse().getContentAsString());
    }

    private static void assertStatus(MvcResult result, int status) {
        assertThat(result.getResponse().getStatus()).isEqualTo(status);
    }

    private static String callback(String client) {
        return client.equals("refresh-native") ? "campuscore://auth/callback"
                : "http://127.0.0.1:3100/session/callback";
    }

    private static String randomValue() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static void await(CountDownLatch latch) throws InterruptedException {
        assertThat(latch.await(WAIT_SECONDS, TimeUnit.SECONDS)).as("deterministic schedule reached its boundary").isTrue();
    }

    static boolean postgresTargetConfigured() {
        return IdentityAtomicPersistencePostgresIT.postgresTargetConfigured();
    }

    private record User(String id, Cookie cookie) { }
    private record Session(String user, String client, String grant, String refresh) { }
}
