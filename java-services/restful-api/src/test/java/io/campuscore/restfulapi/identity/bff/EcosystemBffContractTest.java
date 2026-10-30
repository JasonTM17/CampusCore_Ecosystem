package io.campuscore.restfulapi.identity.bff;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * P05 browser-BFF contract (docs/ecosystem/host-policy.md) on the REAL HTTP
 * stack: the server runs on a fixed port so the loopback legs — BFF token
 * exchange and the /bff/api forward — hit the actual SAS provider chain,
 * the actual resource chain, and the actual lock discipline. Surface
 * resolution goes through the production path: the edge-stamped
 * X-Campuscore-Surface/-Scheme/-Host headers validated by the shared proxy
 * token. Two BFF surfaces plus one REDIRECT apex are configured; secrets
 * and surface hosts are test-scoped.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.DEFINED_PORT,
        properties = {"server.port=14010"})
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "server.port=14010",
        "app.rate-limit.proxy-token=e2e-proxy-token-0123456789",
        "app.cors.allowed-origin-patterns=http://portal.test,http://learn.test,http://campus.test",
        "identity.oidc.enabled=true",
        "identity.oidc.dev-keygen=true",
        "identity.oidc.issuer-uri=http://127.0.0.1:14010",
        "identity.oidc.token-encryption-key=dGVzdC1rZXktMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY=",
        "identity.bff.enabled=true",
        "identity.bff.dev-http=true",
        "identity.bff.issuer-loopback=http://127.0.0.1:14010",
        "identity.bff.issuer-public=http://127.0.0.1:14010",
        "identity.bff.api-allowlist[0]=/api/v1/auth/me",
        // Second allowlist entry exists so businessLaneNeverLeaksUpstreamSetCookie
        // can drive a known Set-Cookie-emitting upstream through /bff/api.
        "identity.bff.api-allowlist[1]=/api/v1/auth/login",
        // P06 anonymous public lane — GET-only pass-through without a session.
        // /public/docs is the probe path: V136 creates the real upstream
        // schema in this H2 set, so a 200 empty page proves the pass-through
        // end-to-end (the app-boot Announcement stub's column coverage
        // belongs to the engagement fixtures, not this suite).
        "identity.bff.public-api-allowlist[0]=/api/v1/public/docs",
        "identity.bff.surfaces[0].id=portal",
        "identity.bff.surfaces[0].mode=BFF",
        "identity.bff.surfaces[0].client-id=cu-portal",
        "identity.bff.surfaces[0].client-secret=bff-portal-secret-0123456789abcdef",
        "identity.bff.surfaces[0].proxy-secret=proxy-portal-secret-0123456789ab",
        "identity.bff.surfaces[0].public-base-url=http://portal.test",
        "identity.bff.surfaces[0].hosts[0]=portal.test",
        "identity.bff.surfaces[0].return-prefixes[0]=/",
        "identity.bff.surfaces[1].id=learn",
        "identity.bff.surfaces[1].mode=BFF",
        "identity.bff.surfaces[1].client-id=cu-learn",
        "identity.bff.surfaces[1].client-secret=bff-learn-secret-0123456789abcdef",
        "identity.bff.surfaces[1].proxy-secret=proxy-learn-secret-0123456789abc",
        "identity.bff.surfaces[1].public-base-url=http://learn.test",
        "identity.bff.surfaces[1].hosts[0]=learn.test",
        "identity.bff.surfaces[1].return-prefixes[0]=/",
        "identity.bff.surfaces[2].id=apex",
        "identity.bff.surfaces[2].mode=REDIRECT",
        "identity.bff.surfaces[2].hosts[0]=campus.test",
        "identity.bff.surfaces[2].redirect-target=http://portal.test"
})
class EcosystemBffContractTest {

    private static final String BASE = "http://127.0.0.1:14010";
    private static final String PROXY_TOKEN = "e2e-proxy-token-0123456789";
    private static final String PORTAL_PROXY_SECRET = "proxy-portal-secret-0123456789ab";
    private static final String PASSWORD = "it-bff-password-1";
    private static final String SESSION_COOKIE = "cu_session_dev";
    private static final String TX_PREFIX = "cu_bff_tx_dev_";

    private final HttpClient http = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NEVER).build();
    private final JdbcTemplate jdbc;
    @Autowired private ObjectMapper mapper;
    @Autowired private PasswordEncoder passwordEncoder;
    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean
    private BffSessionStore logoutStore;
    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean
    private io.campuscore.restfulapi.identity.IdentitySessionMirror logoutMirror;

    EcosystemBffContractTest(@Autowired javax.sql.DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    @BeforeEach
    void resetDemoAccount() {
        jdbc.update(
                "UPDATE campuscore_auth.\"User\" SET \"password\" = ?, \"status\" = 'ACTIVE',"
                        + " \"mustChangePassword\" = FALSE WHERE \"id\" = 'student-user'",
                passwordEncoder.encode(PASSWORD));
        jdbc.update("DELETE FROM campuscore_identity.bff_session");
        jdbc.update("DELETE FROM campuscore_identity.bff_transaction");
        jdbc.update("DELETE FROM campuscore_identity.oauth2_authorization");
    }

    /** The edge-stamped header set every surface-scoped request carries. */
    private static Map<String, String> edge(String surfaceId, String publicHost) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("X-Campuscore-Proxy-Token", PROXY_TOKEN);
        headers.put("X-Campuscore-Surface", surfaceId);
        headers.put("X-Campuscore-Scheme", "http");
        headers.put("X-Campuscore-Host", publicHost);
        return headers;
    }

    private static Map<String, String> edgePortal() {
        return edge("portal", "portal.test");
    }

    private static Map<String, String> edgeLearn() {
        return edge("learn", "learn.test");
    }

    // ---- registry / surface routing --------------------------------------

    @Test
    void requestWithoutTrustedSurfaceContextFailsClosed() throws Exception {
        // Direct-to-Java with no edge headers: the literal Host
        // (127.0.0.1:14010) is not a configured surface — fail closed.
        HttpResponse<String> response = get(BASE + "/session/login", Map.of());
        assertThat(response.statusCode()).isEqualTo(404);
    }

    @Test
    void unknownSurfaceHeaderFailsClosed() throws Exception {
        HttpResponse<String> response = get(BASE + "/session/login",
                edge("stranger", "stranger.test"));
        assertThat(response.statusCode()).isEqualTo(404);
    }

    @Test
    void proxyHeaderWithoutValidTokenIsIgnored() throws Exception {
        Map<String, String> forged = edgePortal();
        forged.put("X-Campuscore-Proxy-Token", "forged");
        HttpResponse<String> response = get(BASE + "/session/login", forged);
        assertThat(response.statusCode()).isEqualTo(404);
    }

    @Test
    void redirectSurfaceBouncesToCanonicalTarget() throws Exception {
        HttpResponse<String> response = get(BASE + "/news/x?y=1",
                edge("apex", "campus.test"));
        assertThat(response.statusCode()).isEqualTo(302);
        assertThat(response.headers().firstValue("Location"))
                .hasValue("http://portal.test/news/x?y=1");
    }

    // ---- full browser journey ---------------------------------------------

    @Test
    void fullLoginCallbackStateApiLogoutJourney() throws Exception {
        String legacyCookies = legacyLogin();

        // 1. Login leg: 302 to the authorize URL on the id host + tx cookie.
        HttpResponse<String> login = get(BASE + "/session/login?return=/dashboard",
                edgePortal());
        assertThat(login.statusCode()).isEqualTo(302);
        String authorize = login.headers().firstValue("Location").orElseThrow();
        assertThat(authorize).startsWith(BASE + "/oauth2/authorize");
        String txCookie = setCookie(login, TX_PREFIX);
        assertThat(txCookie).isNotNull();
        assertThat(login.headers().firstValue("Cache-Control")).hasValue("no-store");

        // 2. Authorize on the id host with the legacy session cookies.
        HttpResponse<String> authorized = get(authorize,
                Map.of("Cookie", legacyCookies));
        assertThat(authorized.statusCode()).isEqualTo(302);
        String callback = authorized.headers().firstValue("Location").orElseThrow();
        assertThat(callback).startsWith("http://portal.test/session/callback?");

        // 3. Callback: tx cookie proves the leg; opaque session cookie minted.
        URI callbackUri = URI.create(callback);
        Map<String, String> cbHeaders = edgePortal();
        cbHeaders.put("Cookie", txCookie);
        HttpResponse<String> cb = get(
                BASE + callbackUri.getPath() + "?" + callbackUri.getQuery(), cbHeaders);
        assertThat(cb.statusCode()).as("callback: %s", cb.body()).isEqualTo(302);
        String sessionCookie = setCookie(cb, SESSION_COOKIE);
        assertThat(sessionCookie).isNotNull();

        // 4. State endpoint: no-store, session-bound CSRF token.
        Map<String, String> sessionHeaders = edgePortal();
        sessionHeaders.put("Cookie", sessionCookie);
        HttpResponse<String> state = get(BASE + "/session/state", sessionHeaders);
        assertThat(state.statusCode()).isEqualTo(200);
        assertThat(state.headers().firstValue("Cache-Control")).hasValue("no-store");
        JsonNode stateBody = mapper.readTree(state.body());
        String csrf = stateBody.get("csrfToken").asText();
        assertThat(csrf).isNotBlank();
        assertThat(stateBody.get("surface").asText()).isEqualTo("portal");

        // 5. Business proxy: opaque cookie in, real /api/v1/auth/me out.
        HttpResponse<String> me = get(BASE + "/bff/api/auth/me", sessionHeaders);
        assertThat(me.statusCode()).as("proxy me: %s", me.body()).isEqualTo(200);
        assertThat(me.body()).contains("student@campuscore.edu");

        // 5b. Session isolation: the portal cookie resolves on the portal
        // surface only — cookie-tossed onto learn it dies (surface binding).
        Map<String, String> learnHeaders = edgeLearn();
        learnHeaders.put("Cookie", sessionCookie);
        HttpResponse<String> crossSurface = get(BASE + "/session/state", learnHeaders);
        assertThat(crossSurface.statusCode()).isEqualTo(401);

        // 6. Logout with the session-bound CSRF token (browser sends
        // Origin + Sec-Fetch-Site on every fetch — the triple-check needs
        // one of them to match the surface base).
        HttpResponse<String> logout = http.send(HttpRequest.newBuilder()
                .uri(URI.create(BASE + "/session/logout"))
                .header("X-Campuscore-Proxy-Token", PROXY_TOKEN)
                .header("X-Campuscore-Surface", "portal")
                .header("X-Campuscore-Scheme", "http")
                .header("X-Campuscore-Host", "portal.test")
                .header("Origin", "http://portal.test")
                .header("Sec-Fetch-Site", "same-origin")
                .header("Cookie", sessionCookie)
                .header("x-csrf-token", csrf)
                .POST(HttpRequest.BodyPublishers.noBody())
                .build(), HttpResponse.BodyHandlers.ofString());
        assertThat(logout.statusCode()).as("logout: %s", logout.body()).isEqualTo(200);
        JsonNode logoutBody = mapper.readTree(logout.body());
        assertThat(logoutBody.get("logoutUrl").asText())
                .startsWith(BASE + "/connect/logout");

        // 7. Session is dead after logout.
        HttpResponse<String> after = get(BASE + "/session/state", sessionHeaders);
        assertThat(after.statusCode()).isEqualTo(401);
    }

    @Test
    void callbackRejectsReplayedState() throws Exception {
        String legacyCookies = legacyLogin();
        HttpResponse<String> login = get(BASE + "/session/login", edgePortal());
        String authorize = login.headers().firstValue("Location").orElseThrow();
        String txCookie = setCookie(login, TX_PREFIX);
        HttpResponse<String> authorized = get(authorize, Map.of("Cookie", legacyCookies));
        URI callbackUri = URI.create(
                authorized.headers().firstValue("Location").orElseThrow());
        String path = callbackUri.getPath() + "?" + callbackUri.getQuery();

        Map<String, String> headers = edgePortal();
        headers.put("Cookie", txCookie);
        HttpResponse<String> first = get(BASE + path, headers);
        assertThat(first.statusCode()).isEqualTo(302);

        // The tx row is consumed atomically — the same state can never
        // complete a second login leg even with the same tx cookie.
        HttpResponse<String> second = get(BASE + path, headers);
        assertThat(second.statusCode()).isEqualTo(401);
    }

    @Test
    void stateEndpointNeverLiesWhenGrantIsGone() throws Exception {
        String sessionCookie = establishSession();
        jdbc.update("DELETE FROM campuscore_identity.oauth2_authorization");
        Map<String, String> headers = edgePortal();
        headers.put("Cookie", sessionCookie);
        HttpResponse<String> state = get(BASE + "/session/state", headers);
        assertThat(state.statusCode()).isEqualTo(401);
        // And the dead session row was marked revoked — it can never serve
        // the cookie again even though retention has not swept it yet.
        Integer live = jdbc.queryForObject(
                "SELECT COUNT(*) FROM campuscore_identity.bff_session"
                        + " WHERE revoked_at IS NULL", Integer.class);
        assertThat(live).isEqualTo(0);
    }

    @Test
    void logoutRequiresSessionBoundCsrf() throws Exception {
        String sessionCookie = establishSession();
        HttpResponse<String> logout = http.send(HttpRequest.newBuilder()
                .uri(URI.create(BASE + "/session/logout"))
                .header("X-Campuscore-Proxy-Token", PROXY_TOKEN)
                .header("X-Campuscore-Surface", "portal")
                .header("X-Campuscore-Scheme", "http")
                .header("X-Campuscore-Host", "portal.test")
                .header("Origin", "http://portal.test")
                .header("Sec-Fetch-Site", "same-origin")
                .header("Cookie", sessionCookie)
                .POST(HttpRequest.BodyPublishers.noBody())
                .build(), HttpResponse.BodyHandlers.ofString());
        assertThat(logout.statusCode()).isEqualTo(403);
        assertThat(logout.body()).contains("CSRF_TOKEN");
    }

    @Test
    void secondLogoutIsIdempotent() throws Exception {
        String sessionCookie = establishSession();
        Map<String, String> sessionHeaders = edgePortal();
        sessionHeaders.put("Cookie", sessionCookie);
        String csrf = mapper.readTree(
                get(BASE + "/session/state", sessionHeaders).body())
                .get("csrfToken").asText();

        HttpResponse<String> first = postLogout(sessionCookie, csrf);
        assertThat(first.statusCode()).isEqualTo(200);

        // The first logout sweeps the session row (revokeClientGrants), so
        // the browser's inevitable retry must still get the id logout URL —
        // a 403 here strands the cc_session on the id host and the next
        // /session/login silently re-authenticates (tester DEFECT-1).
        HttpResponse<String> second = postLogout(sessionCookie, csrf);
        assertThat(second.statusCode()).as("second logout: %s", second.body())
                .isEqualTo(200);
        String logoutUrl = mapper.readTree(second.body()).get("logoutUrl").asText();
        assertThat(logoutUrl).startsWith(BASE + "/connect/logout")
                .doesNotContain("id_token_hint=");
    }

    @Test
    void foreignOriginRejectedOnReadPaths() throws Exception {
        String sessionCookie = establishSession();
        Map<String, String> headers = edgePortal();
        headers.put("Cookie", sessionCookie);
        headers.put("Origin", "http://evil.test");

        // A credentialed same-site sibling fetch always carries its own
        // Origin — a foreign one must never read session state (R1).
        assertThat(get(BASE + "/session/state", headers).statusCode())
                .isEqualTo(403);
        assertThat(get(BASE + "/bff/api/auth/me", headers).statusCode())
                .isEqualTo(403);
        // Control: the surface's own origin passes both guards.
        headers.put("Origin", "http://portal.test");
        assertThat(get(BASE + "/session/state", headers).statusCode())
                .isEqualTo(200);
    }

    @Test
    void stampedHostOutsideRegistryDegradesToPublicBase() throws Exception {
        // A valid proxy token must not let the edge (or anyone holding it)
        // poison the public base onto an unregistered host — the authorize
        // URL's redirect_uri degrades to the canonical publicBaseUrl
        // (tester DEFECT-2).
        Map<String, String> forged = edge("portal", "evil.test");
        HttpResponse<String> login = get(BASE + "/session/login", forged);
        assertThat(login.statusCode()).isEqualTo(302);
        String authorize = login.headers().firstValue("Location").orElseThrow();
        assertThat(authorize).contains(
                "redirect_uri=" + java.net.URLEncoder.encode(
                        "http://portal.test/session/callback",
                        java.nio.charset.StandardCharsets.UTF_8));
        assertThat(authorize).doesNotContain("evil.test");
    }

    @Test
    void credentialEpochBumpKillsTheBffLane() throws Exception {
        String sessionCookie = establishSession();
        // Admin role change bumps the epoch (ADMIN_MUTATION): the grant's
        // minted credentialVersion now trails the account — every lane the
        // opaque cookie can reach must fail on the next request.
        jdbc.update("UPDATE campuscore_auth.\"User\""
                + " SET \"credentialVersion\" = \"credentialVersion\" + 1"
                + " WHERE \"id\" = 'student-user'");

        Map<String, String> headers = edgePortal();
        headers.put("Cookie", sessionCookie);
        assertThat(get(BASE + "/session/state", headers).statusCode())
                .isEqualTo(401);
        assertThat(get(BASE + "/bff/api/auth/me", headers).statusCode())
                .isEqualTo(401);
    }

    // ---- cookie matrix (§2) ----------------------------------------------

    @Test
    void txCookieIsPathScopedAndDiesAtCallback() throws Exception {
        String legacyCookies = legacyLogin();
        HttpResponse<String> login = get(BASE + "/session/login?return=/dashboard",
                edgePortal());
        assertThat(login.statusCode()).isEqualTo(302);

        // §2 tx cookie: per-login name, scoped to /session/callback so the
        // marker only rides the leg that needs it, Lax (top-level GET only),
        // short-lived (<=300s), HttpOnly, and never a Domain attribute.
        String txSetCookie = null;
        for (String header : login.headers().allValues("Set-Cookie")) {
            if (header.startsWith(TX_PREFIX)) {
                txSetCookie = header;
            }
        }
        assertThat(txSetCookie).as("tx Set-Cookie headers: %s",
                login.headers().allValues("Set-Cookie")).isNotNull();
        assertThat(txSetCookie).contains("Path=/session/callback")
                .contains("SameSite=Lax").contains("HttpOnly")
                .doesNotContain("Domain=");
        int maxAge = Integer.parseInt(
                txSetCookie.replaceAll(".*Max-Age=(\\d+).*", "$1"));
        assertThat(maxAge).isLessThanOrEqualTo(300);
        String txCookie = txSetCookie.substring(0, txSetCookie.indexOf(';'));

        HttpResponse<String> authorized = get(
                login.headers().firstValue("Location").orElseThrow(),
                Map.of("Cookie", legacyCookies));
        URI callbackUri = URI.create(
                authorized.headers().firstValue("Location").orElseThrow());
        Map<String, String> cbHeaders = edgePortal();
        cbHeaders.put("Cookie", txCookie);
        HttpResponse<String> cb = get(
                BASE + callbackUri.getPath() + "?" + callbackUri.getQuery(), cbHeaders);
        assertThat(cb.statusCode()).as("callback: %s", cb.body()).isEqualTo(302);

        // expireTxCookies: the same per-login name is re-emitted, emptied, at
        // Max-Age=0 — the browser must not carry a tx marker past the leg.
        String txName = txCookie.substring(0, txCookie.indexOf('='));
        boolean expired = cb.headers().allValues("Set-Cookie").stream().anyMatch(
                h -> h.startsWith(txName + "=") && h.contains("Max-Age=0"));
        assertThat(expired).as("callback Set-Cookie: %s",
                cb.headers().allValues("Set-Cookie")).isTrue();

        // §2 session cookie: host-only, Path=/, HttpOnly, SameSite=Strict.
        // The opaque value is minted at callback (fixation defense) — it is
        // not the txId the pre-login browser already knew.
        String sessionSetCookie = cb.headers().allValues("Set-Cookie").stream()
                .filter(h -> h.startsWith(SESSION_COOKIE + "="))
                .findFirst().orElseThrow();
        assertThat(sessionSetCookie).contains("Path=/;")
                .contains("SameSite=Strict").contains("HttpOnly")
                .doesNotContain("Domain=");
        String opaque = sessionSetCookie.substring(
                SESSION_COOKIE.length() + 1, sessionSetCookie.indexOf(';'));
        assertThat(opaque).isNotEqualTo(txCookie.substring(txCookie.indexOf('=') + 1));

        // §2 cc_csrf hint: readable (the SPA bootstrap + X-CSRF-Token echo
        // depend on document.cookie), host-only, Lax, and carrying the same
        // csrfToken /session/state reports for this session.
        String csrfSetCookie = cb.headers().allValues("Set-Cookie").stream()
                .filter(h -> h.startsWith("cc_csrf="))
                .findFirst().orElseThrow();
        assertThat(csrfSetCookie).contains("Path=/;")
                .contains("SameSite=Strict")
                .doesNotContain("Domain=")
                .doesNotContain("HttpOnly");
        String csrfHint = csrfSetCookie.substring(
                "cc_csrf=".length(), csrfSetCookie.indexOf(';'));
        Map<String, String> stateHeaders = edgePortal();
        stateHeaders.put("Cookie", SESSION_COOKIE + "=" + opaque);
        HttpResponse<String> state = get(BASE + "/session/state", stateHeaders);
        assertThat(state.statusCode()).as("state: %s", state.body()).isEqualTo(200);
        assertThat(mapper.readTree(state.body()).get("csrfToken").asText())
                .isEqualTo(csrfHint);

        // §3 schema: only sha256(opaque) is stored — a database dump can
        // never be replayed as a session cookie.
        String storedId = jdbc.queryForObject(
                "SELECT id FROM campuscore_identity.bff_session", String.class);
        assertThat(storedId).isEqualTo(BffSessionStore.sha256Hex(opaque));
    }

    // ---- business proxy (§5) ----------------------------------------------

    @Test
    void businessLaneNeverLeaksUpstreamSetCookie() throws Exception {
        String sessionCookie = establishSession();
        Map<String, String> sessionHeaders = edgePortal();
        sessionHeaders.put("Cookie", sessionCookie);
        HttpResponse<String> state = get(BASE + "/session/state", sessionHeaders);
        String csrf = mapper.readTree(state.body()).get("csrfToken").asText();

        // /api/v1/auth/login is allowlisted in this suite and answers with
        // legacy cc_* Set-Cookie headers (see legacyLogin) — the opaque
        // session is the only cookie the BFF lane may ever hand a browser.
        String body = "{\"email\":\"student@campuscore.edu\",\"password\":\""
                + PASSWORD + "\"}";
        HttpResponse<String> response = http.send(HttpRequest.newBuilder()
                .uri(URI.create(BASE + "/bff/api/auth/login"))
                .header("X-Campuscore-Proxy-Token", PROXY_TOKEN)
                .header("X-Campuscore-Surface", "portal")
                .header("X-Campuscore-Scheme", "http")
                .header("X-Campuscore-Host", "portal.test")
                .header("Origin", "http://portal.test")
                .header("Sec-Fetch-Site", "same-origin")
                .header("Cookie", sessionCookie)
                .header("x-csrf-token", csrf)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build(), HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode())
                .as("login via bff: %s", response.body()).isEqualTo(200);
        assertThat(response.headers().allValues("Set-Cookie"))
                .as("BFF lane must strip every upstream Set-Cookie")
                .isEmpty();
    }

    // ---- logout idempotence + landing (§3/§6) ------------------------------

    @Test
    void revokedSessionLogoutStillReturnsLogoutUrl() throws Exception {
        String sessionCookie = establishSession();
        Map<String, String> sessionHeaders = edgePortal();
        sessionHeaders.put("Cookie", sessionCookie);
        HttpResponse<String> state = get(BASE + "/session/state", sessionHeaders);
        String csrf = mapper.readTree(state.body()).get("csrfToken").asText();

        // Authority-driven revoke (replay / account kill): the grant row is
        // already gone but the session row may still sit revoked_at until
        // retention sweeps it. §3 idempotence: logout must still hand the
        // browser the id logout URL — with a null id_token_hint.
        jdbc.update("UPDATE campuscore_identity.bff_session"
                + " SET revoked_at = CURRENT_TIMESTAMP");
        jdbc.update("DELETE FROM campuscore_identity.oauth2_authorization");

        HttpResponse<String> logout = postLogout(sessionCookie, csrf);
        assertThat(logout.statusCode()).as("logout: %s", logout.body()).isEqualTo(200);
        String logoutUrl = mapper.readTree(logout.body()).get("logoutUrl").asText();
        assertThat(logoutUrl).startsWith(BASE + "/connect/logout");
        assertThat(logoutUrl).contains("post_logout_redirect_uri=");
        assertThat(logoutUrl).contains("session%2Flogged-out");
        assertThat(logoutUrl).doesNotContain("id_token_hint=");
        // The opaque cookie is always cleared, even on the idempotent path.
        boolean cleared = logout.headers().allValues("Set-Cookie").stream()
                .anyMatch(h -> h.startsWith(SESSION_COOKIE + "=")
                        && h.contains("Max-Age=0"));
        assertThat(cleared).isTrue();
        // The csrf hint dies with it — a stale hint would make the SPA
        // bootstrap a session that no longer exists.
        boolean csrfCleared = logout.headers().allValues("Set-Cookie").stream()
                .anyMatch(h -> h.startsWith("cc_csrf=") && h.contains("Max-Age=0"));
        assertThat(csrfCleared).isTrue();

        // §6: the logged-out landing endpoint is reachable on the surface.
        HttpResponse<String> loggedOut = get(BASE + "/session/logged-out",
                edgePortal());
        assertThat(loggedOut.statusCode()).isEqualTo(200);
        assertThat(loggedOut.headers().firstValue("Content-Type").orElse(""))
                .contains("text/html");
    }

    // ---- anonymous public lane (host-policy §5a, P06) --------------------

    @Test
    void anonymousGetOnPublicLaneProxiesWithoutBearer() throws Exception {
        // No session cookie at all + GET on the public allowlist → the proxy
        // forwards with NO Authorization header; upstream permitAll answers.
        HttpResponse<String> response = get(BASE + "/bff/api/public/docs",
                edgePortal());
        assertThat(response.statusCode())
                .as("anonymous public read: %s", response.body())
                .isEqualTo(200);
    }

    @Test
    void anonymousGetOnSessionPathStillRequiresSession() throws Exception {
        // The public lane never widens: session-scoped paths still 401.
        HttpResponse<String> response = get(BASE + "/bff/api/auth/me",
                edgePortal());
        assertThat(response.statusCode()).isEqualTo(401);
        assertThat(response.body()).contains("SESSION_REQUIRED");
    }

    @Test
    void staleSessionCookieOnPublicPathFailsClosed() throws Exception {
        // A present-but-invalid opaque cookie must NOT silently downgrade to
        // anonymous — fail closed so the surface notices the dead session.
        Map<String, String> headers = edgePortal();
        headers.put("Cookie", SESSION_COOKIE + "=forged-opaque-value");
        HttpResponse<String> response = get(BASE + "/bff/api/public/docs",
                headers);
        assertThat(response.statusCode()).isEqualTo(401);
    }

    @Test
    void proxyRejectsForgedSurfaceCredential() throws Exception {
        // A browser may stamp a surface header on a business call — the
        // resource side demands the matching per-surface secret (§2.2).
        HttpResponse<String> response = get(BASE + "/api/v1/auth/me",
                Map.of("X-Campuscore-Surface", "portal",
                        "X-Campuscore-Bff-Secret", "wrong-secret"));
        assertThat(response.statusCode()).isEqualTo(403);
        assertThat(response.body()).contains("PROXY_CONTEXT_REJECTED");
    }

    @Test
    void proxyAcceptsValidSurfaceCredential() throws Exception {
        HttpResponse<String> response = get(BASE + "/api/v1/auth/me",
                Map.of("X-Campuscore-Surface", "portal",
                        "X-Campuscore-Bff-Secret", PORTAL_PROXY_SECRET));
        // Passes the proxy-context check; then resource auth decides.
        assertThat(response.statusCode()).isIn(200, 401);
    }

    // ---- AUD-06 fault and negative matrix ----------------------------------

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"session-store", "grant-store"})
    void logoutStoreFailureRollsBackCookiesAndSessionThenRetrySucceeds(String fault) throws Exception {
        String cookie = establishSession();
        String csrf = csrfFor(cookie);
        int grants = jdbc.queryForObject("SELECT COUNT(*) FROM campuscore_identity.oauth2_authorization",
                Integer.class);
        if ("session-store".equals(fault)) {
            org.mockito.Mockito.doThrow(new IllegalStateException("AUD06 synthetic session-store failure"))
                    .when(logoutStore).revokeSession(org.mockito.ArgumentMatchers.anyString(),
                            org.mockito.ArgumentMatchers.eq("portal"));
        } else {
            // The session marker and grant deletion have already executed in
            // the transaction: failure here must roll BOTH back.
            org.mockito.Mockito.doThrow(new IllegalStateException("AUD06 synthetic grant-store failure"))
                    .when(logoutMirror).deleteOidcSessionsForClient("student-user", "cu-portal");
        }
        HttpResponse<String> failed = postLogout(cookie, csrf);
        assertThat(failed.statusCode()).isEqualTo(500);
        assertThat(failed.headers().allValues("Set-Cookie")).isEmpty();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM campuscore_identity.bff_session"
                + " WHERE revoked_at IS NULL", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM campuscore_identity.oauth2_authorization",
                Integer.class)).isEqualTo(grants);
        Map<String, String> stateHeaders = edgePortal();
        stateHeaders.put("Cookie", cookie);
        assertThat(get(BASE + "/session/state", stateHeaders).statusCode()).isEqualTo(200);
        org.mockito.Mockito.doCallRealMethod().when(logoutStore)
                .revokeSession(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.eq("portal"));
        org.mockito.Mockito.doCallRealMethod().when(logoutMirror)
                .deleteOidcSessionsForClient("student-user", "cu-portal");
        HttpResponse<String> recovered = postLogout(cookie, csrf);
        assertThat(recovered.statusCode()).isEqualTo(200);
        assertThat(recovered.headers().allValues("Set-Cookie")).hasSize(2)
                .allMatch(value -> value.contains("Max-Age=0"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM campuscore_identity.bff_session",
                Integer.class)).isZero();
        assertThat(postLogout(cookie, csrf).statusCode()).as("documented idempotent retry").isEqualTo(200);
    }

    @Test
    void logoutRejectsMissingWrongAndOtherSessionCsrfWithoutClearingCookies() throws Exception {
        String first = establishSession();
        String second = establishSession();
        String otherToken = csrfFor(second);
        for (String token : new String[] {null, "wrong-token", otherToken}) {
            HttpResponse<String> response = logoutRequest(first, token,
                    "http://portal.test", "same-origin", null, "");
            assertThat(response.statusCode()).isEqualTo(403);
            assertThat(response.headers().allValues("Set-Cookie")).isEmpty();
        }
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM campuscore_identity.bff_session"
                + " WHERE revoked_at IS NULL", Integer.class)).isEqualTo(2);
    }

    @Test
    void logoutRejectsForeignOriginMissingProvenanceAndCrossSiteFetch() throws Exception {
        String cookie = establishSession();
        String csrf = csrfFor(cookie);
        assertThat(logoutRequest(cookie, csrf, "http://learn.test", "same-origin", null, "")
                .statusCode()).isEqualTo(403);
        assertThat(logoutRequest(cookie, csrf, "https://evil.invalid", "cross-site", null, "")
                .statusCode()).isEqualTo(403);
        assertThat(logoutRequest(cookie, csrf, null, null, "https://evil.invalid/", "")
                .statusCode()).isEqualTo(403);
        assertThat(logoutRequest(cookie, csrf, "http://portal.test", "cross-site", null, "")
                .statusCode()).isEqualTo(403);
    }

    @Test
    void logoutRefererIsIgnoredWhenSameOriginMetadataIsPresentKnownPolicyGap() throws Exception {
        String cookie = establishSession();
        String csrf = csrfFor(cookie);
        assertThat(logoutRequest(cookie, csrf, null, "same-origin", "https://evil.invalid/", "")
                .statusCode()).as("known policy gap: Fetch Metadata authorizes without checking Referer")
                .isEqualTo(200);
    }

    @Test
    void staleTabBusinessMutationIsRejectedButLogoutRetryIsDocumentedException() throws Exception {
        String cookie = establishSession();
        String csrf = csrfFor(cookie);
        assertThat(postLogout(cookie, csrf).statusCode()).isEqualTo(200);
        // Same cookie/token represents the second tab after tab one logs out.
        HttpRequest.Builder mutation = HttpRequest.newBuilder(URI.create(BASE + "/bff/api/auth/me"));
        edgePortal().forEach(mutation::header);
        var stale = http.send(mutation.header("Cookie", cookie)
                .header("Origin", "http://portal.test").header("Sec-Fetch-Site", "same-origin")
                .header("x-csrf-token", csrf).POST(HttpRequest.BodyPublishers.noBody()).build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(stale.statusCode()).isIn(401, 403);
        assertThat(postLogout(cookie, csrf).statusCode()).as("known policy conflict: stale logout is allowed")
                .isEqualTo(200);
        assertThat(logoutRequest(cookie, csrf, "https://evil.invalid", "cross-site", null, "")
                .statusCode()).isEqualTo(403);
    }

    @Test
    void logoutGetIsRejectedAndReturnToCannotOverrideFixedLogoutDestination() throws Exception {
        String cookie = establishSession();
        String csrf = csrfFor(cookie);
        Map<String, String> headers = edgePortal();
        headers.put("Cookie", cookie);
        assertThat(get(BASE + "/session/logout?returnTo=https%3A%2F%2Fevil.invalid", headers)
                .statusCode()).isEqualTo(405);
        HttpResponse<String> result = logoutRequest(cookie, csrf, "http://portal.test", "same-origin", null,
                "?returnTo=https%3A%2F%2Fevil.invalid&returnTo=%2F%2Fevil.invalid"
                        + "&post_logout_redirect_uri=https%3A%2F%2Fevil.invalid");
        assertThat(result.statusCode()).isEqualTo(200);
        String logoutUrl = mapper.readTree(result.body()).get("logoutUrl").asText();
        assertThat(logoutUrl.contains("evil.invalid")).isFalse();
        assertThat(logoutUrl.contains("http%3A%2F%2Fportal.test%2Fsession%2Flogged-out")).isTrue();
    }

    @Test
    void returnedLogoutUrlCannotCompleteEndSessionAfterGrantDeletionKnownContractGap() throws Exception {
        String cookie = establishSession();
        String csrf = csrfFor(cookie);
        HttpResponse<String> first = postLogout(cookie, csrf);
        assertThat(first.statusCode()).isEqualTo(200);
        String firstUrl = mapper.readTree(first.body()).get("logoutUrl").asText();
        assertThat(get(firstUrl, Map.of()).statusCode())
                .as("known gap: SAS cannot resolve the hint after the BFF deleted its grant").isEqualTo(400);
        HttpResponse<String> retry = postLogout(cookie, csrf);
        assertThat(retry.statusCode()).isEqualTo(200);
        String retryUrl = mapper.readTree(retry.body()).get("logoutUrl").asText();
        assertThat(get(retryUrl, Map.of()).statusCode())
                .as("known gap: SAS 7.1 requires a hint, contrary to host-policy hint-null claim").isEqualTo(400);
    }

    @Test
    void returnPathRejectsOpenRedirectsAndMalformedCallbackCannotCreateSession() throws Exception {
        for (String target : List.of("https://evil.invalid/", "//evil.invalid/", "/\\evil.invalid",
                "/session/logout", "/api/v1/auth/logout")) {
            HttpResponse<String> login = get(BASE + "/session/login?return="
                    + java.net.URLEncoder.encode(target, java.nio.charset.StandardCharsets.UTF_8), edgePortal());
            assertThat(login.statusCode()).isEqualTo(302);
        }
        assertThat(jdbc.queryForList("SELECT return_path FROM campuscore_identity.bff_transaction", String.class))
                .allMatch("/"::equals);
        for (String query : List.of("", "?state=x", "?state=x&code=x&state=y", "?state=x&code=x&code=y")) {
            HttpResponse<String> callback = get(BASE + "/session/callback" + query, edgePortal());
            assertThat(callback.statusCode()).isIn(400, 401);
            assertThat(callback.headers().allValues("Set-Cookie").stream()
                    .anyMatch(value -> value.startsWith(SESSION_COOKIE + "="))).isFalse();
        }
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM campuscore_identity.bff_session", Integer.class))
                .isZero();
    }

    @Test
    void duplicateCallbackParametersRejectOtherwiseValidCodeAndState() throws Exception {
        String legacyCookies = legacyLogin();
        for (String duplicateKey : List.of("code=", "state=")) {
            var login = get(BASE + "/session/login", edgePortal());
            String txCookie = setCookie(login, TX_PREFIX);
            var authorized = get(login.headers().firstValue("Location").orElseThrow(),
                    Map.of("Cookie", legacyCookies));
            URI callback = URI.create(authorized.headers().firstValue("Location").orElseThrow());
            String query = callback.getRawQuery();
            String duplicate = java.util.Arrays.stream(query.split("&"))
                    .filter(pair -> pair.startsWith(duplicateKey)).findFirst().orElseThrow();
            Map<String, String> headers = edgePortal();
            headers.put("Cookie", txCookie);
            var rejected = get(BASE + callback.getRawPath() + "?" + query + "&" + duplicate, headers);
            assertThat(rejected.statusCode()).as("duplicate callback field must not mint a session")
                    .isIn(400, 401);
            assertThat(rejected.headers().allValues("Set-Cookie").stream()
                    .anyMatch(value -> value.startsWith(SESSION_COOKIE + "=") && !value.contains("Max-Age=0")))
                    .isFalse();
        }
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM campuscore_identity.bff_session", Integer.class))
                .isZero();
    }

    private String csrfFor(String cookie) throws Exception {
        Map<String, String> headers = edgePortal();
        headers.put("Cookie", cookie);
        HttpResponse<String> response = get(BASE + "/session/state", headers);
        assertThat(response.statusCode()).isEqualTo(200);
        return mapper.readTree(response.body()).get("csrfToken").asText();
    }

    private HttpResponse<String> logoutRequest(String cookie, String token, String origin,
            String fetchSite, String referer, String query) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(BASE + "/session/logout" + query));
        edgePortal().forEach(builder::header);
        builder.header("Cookie", cookie);
        if (token != null) builder.header("x-csrf-token", token);
        if (origin != null) builder.header("Origin", origin);
        if (fetchSite != null) builder.header("Sec-Fetch-Site", fetchSite);
        if (referer != null) builder.header("Referer", referer);
        return http.send(builder.POST(HttpRequest.BodyPublishers.noBody()).build(),
                HttpResponse.BodyHandlers.ofString());
    }

    // ---- helpers -----------------------------------------------------------

    /** POST /session/logout on the portal surface with the CSRF triple. */
    private HttpResponse<String> postLogout(String sessionCookie, String csrf)
            throws Exception {
        return http.send(HttpRequest.newBuilder()
                .uri(URI.create(BASE + "/session/logout"))
                .header("X-Campuscore-Proxy-Token", PROXY_TOKEN)
                .header("X-Campuscore-Surface", "portal")
                .header("X-Campuscore-Scheme", "http")
                .header("X-Campuscore-Host", "portal.test")
                .header("Origin", "http://portal.test")
                .header("Sec-Fetch-Site", "same-origin")
                .header("Cookie", sessionCookie)
                .header("x-csrf-token", csrf)
                .POST(HttpRequest.BodyPublishers.noBody())
                .build(), HttpResponse.BodyHandlers.ofString());
    }

    /** Full login journey — returns the opaque session cookie. */
    private String establishSession() throws Exception {
        String legacyCookies = legacyLogin();
        HttpResponse<String> login = get(BASE + "/session/login", edgePortal());
        String authorize = login.headers().firstValue("Location").orElseThrow();
        String txCookie = setCookie(login, TX_PREFIX);
        HttpResponse<String> authorized = get(authorize, Map.of("Cookie", legacyCookies));
        URI callbackUri = URI.create(
                authorized.headers().firstValue("Location").orElseThrow());
        Map<String, String> headers = edgePortal();
        headers.put("Cookie", txCookie);
        HttpResponse<String> cb = get(
                BASE + callbackUri.getPath() + "?" + callbackUri.getQuery(), headers);
        assertThat(cb.statusCode()).as("callback: %s", cb.body()).isEqualTo(302);
        return setCookie(cb, SESSION_COOKIE);
    }

    /** Legacy login on the id host — the SSO authority the authorize leg sees. */
    private String legacyLogin() throws Exception {
        String body = "{\"email\":\"student@campuscore.edu\",\"password\":\"" + PASSWORD + "\"}";
        HttpResponse<String> response = http.send(HttpRequest.newBuilder()
                .uri(URI.create(BASE + "/api/v1/auth/login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build(), HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode())
                .as("legacy login: %s", response.body())
                .isEqualTo(200);
        List<String> cookies = new ArrayList<>();
        response.headers().allValues("Set-Cookie").forEach(value -> {
            int semi = value.indexOf(';');
            cookies.add(semi > 0 ? value.substring(0, semi) : value);
        });
        return String.join("; ", cookies);
    }

    private HttpResponse<String> get(String url, Map<String, String> headers)
            throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder().uri(URI.create(url));
        headers.forEach(builder::header);
        return http.send(builder.GET().build(), HttpResponse.BodyHandlers.ofString());
    }

    private static String setCookie(HttpResponse<?> response, String nameOrPrefix) {
        for (String header : response.headers().allValues("Set-Cookie")) {
            if (header.startsWith(nameOrPrefix)) {
                int semi = header.indexOf(';');
                return semi > 0 ? header.substring(0, semi) : header;
            }
        }
        return null;
    }
}
