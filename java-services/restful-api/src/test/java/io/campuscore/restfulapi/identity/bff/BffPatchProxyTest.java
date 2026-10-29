package io.campuscore.restfulapi.identity.bff;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import tools.jackson.databind.ObjectMapper;

/**
 * BFF business-lane transport regression on the REAL HTTP stack (same wiring
 * as {@link EcosystemBffContractTest}, own port). The proxy used to hand the
 * inbound verb to {@code HttpURLConnection.setRequestMethod}, whose accepted
 * method list has no PATCH — any PATCH route behind the allowlist died before
 * it ever reached upstream. A local probe filter stands in as the upstream so
 * the test sees the exact verb and body the loopback leg delivers; the
 * attendance prefixes prove the allowlist addition reaches upstream RBAC
 * rather than the proxy's PATH_NOT_ALLOWED gate.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.DEFINED_PORT,
        properties = {"server.port=14011"})
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "server.port=14011",
        "app.rate-limit.proxy-token=e2e-proxy-token-0123456789",
        "app.cors.allowed-origin-patterns=http://portal.test,http://learn.test,http://campus.test",
        "identity.oidc.enabled=true",
        "identity.oidc.dev-keygen=true",
        "identity.oidc.issuer-uri=http://127.0.0.1:14011",
        "identity.oidc.token-encryption-key=dGVzdC1rZXktMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY=",
        "identity.bff.enabled=true",
        "identity.bff.dev-http=true",
        "identity.bff.issuer-loopback=http://127.0.0.1:14011",
        "identity.bff.issuer-public=http://127.0.0.1:14011",
        // api-allowlist binds from application.yml on purpose: a list property
        // in this source would replace the whole list, and the attendance
        // cases below must prove the production prefixes — so the PATCH probe
        // rides the existing /api/v1/notifications prefix instead.
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
class BffPatchProxyTest {

    private static final String BASE = "http://127.0.0.1:14011";
    private static final String PROXY_TOKEN = "e2e-proxy-token-0123456789";
    private static final String PASSWORD = "it-bff-password-1";
    private static final String SESSION_COOKIE = "cu_session_dev";
    private static final String TX_PREFIX = "cu_bff_tx_dev_";

    private final HttpClient http = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NEVER).build();
    private final JdbcTemplate jdbc;
    @Autowired private ObjectMapper mapper;
    @Autowired private PasswordEncoder passwordEncoder;

    BffPatchProxyTest(@Autowired javax.sql.DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    @BeforeEach
    void resetFixture() {
        jdbc.update(
                "UPDATE campuscore_auth.\"User\" SET \"password\" = ?, \"status\" = 'ACTIVE',"
                        + " \"mustChangePassword\" = FALSE WHERE \"id\" = 'student-user'",
                passwordEncoder.encode(PASSWORD));
        jdbc.update("DELETE FROM campuscore_identity.bff_session");
        jdbc.update("DELETE FROM campuscore_identity.bff_transaction");
        jdbc.update("DELETE FROM campuscore_identity.oauth2_authorization");
        jdbc.update("DELETE FROM campuscore_auth.\"UserRole\" WHERE \"id\" = 'ur-patch-test'");
    }

    /** Edge-stamped header set every surface-scoped request carries. */
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

    // ---- PATCH transport --------------------------------------------------

    @Test
    void patchRoundTripsBodyAndResponseThroughTheProxy() throws Exception {
        String sessionCookie = establishSession();
        String csrf = csrfFor(sessionCookie);
        String body = "{\"reason\":\"transport probe\"}";
        HttpResponse<String> response = http.send(HttpRequest.newBuilder()
                .uri(URI.create(BASE + "/bff/api/notifications/bff-patch-probe"))
                .header("X-Campuscore-Proxy-Token", PROXY_TOKEN)
                .header("X-Campuscore-Surface", "portal")
                .header("X-Campuscore-Scheme", "http")
                .header("X-Campuscore-Host", "portal.test")
                .header("Origin", "http://portal.test")
                .header("Sec-Fetch-Site", "same-origin")
                .header("Cookie", sessionCookie)
                .header("x-csrf-token", csrf)
                .header("Content-Type", "application/json")
                .method("PATCH", HttpRequest.BodyPublishers.ofString(body))
                .build(), HttpResponse.BodyHandlers.ofString());

        assertThat(response.statusCode()).as("probe relay: %s", response.body()).isEqualTo(200);
        // The probe echoes what the loopback leg actually delivered: the
        // PATCH verb, the untouched JSON body, and the injected bearer +
        // surface credential pair (never their values).
        assertThat(response.body()).contains("method=PATCH");
        assertThat(response.body()).contains("body=" + body);
        assertThat(response.body()).contains("authorized=true");
        assertThat(response.body()).contains("surface=portal");
        assertThat(response.headers().firstValue("X-Probe-Echo")).hasValue("patch-echo");
    }

    @Test
    void anonymousPatchIsRejectedByTheSessionBoundCsrfGate() throws Exception {
        // Gate order: a mutation without the session-bound x-csrf-token dies
        // before session resolution — the new transport changes nothing here.
        HttpResponse<String> response = http.send(HttpRequest.newBuilder()
                .uri(URI.create(BASE + "/bff/api/notifications/bff-patch-probe"))
                .header("X-Campuscore-Proxy-Token", PROXY_TOKEN)
                .header("X-Campuscore-Surface", "portal")
                .header("X-Campuscore-Scheme", "http")
                .header("X-Campuscore-Host", "portal.test")
                .header("Origin", "http://portal.test")
                .header("Sec-Fetch-Site", "same-origin")
                .header("Content-Type", "application/json")
                .method("PATCH", HttpRequest.BodyPublishers.ofString("{}"))
                .build(), HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(403);
        assertThat(response.body()).contains("CSRF_TOKEN");
    }

    // ---- attendance allowlist ---------------------------------------------

    @Test
    void studentAttendanceReadIsDeniedByUpstreamRbacNotTheAllowlist() throws Exception {
        String sessionCookie = establishSession();
        Map<String, String> headers = edgePortal();
        headers.put("Cookie", sessionCookie);
        HttpResponse<String> denied = get(BASE + "/bff/api/attendance/geofences/active", headers);
        // Forwarded: the controller-level role check answered, so the
        // response is the upstream denial, not the proxy's PATH_NOT_ALLOWED.
        assertThat(denied.statusCode()).as("student active-geofences: %s", denied.body())
                .isEqualTo(403);
        assertThat(denied.body()).contains("ACCESS_DENIED");
    }

    @Test
    void studentAdminGeofenceReadIsDeniedByUpstreamRbacNotTheAllowlist() throws Exception {
        String sessionCookie = establishSession();
        Map<String, String> headers = edgePortal();
        headers.put("Cookie", sessionCookie);
        HttpResponse<String> denied = get(BASE + "/bff/api/admin/attendance/geofences", headers);
        assertThat(denied.statusCode()).as("student admin geofences: %s", denied.body())
                .isEqualTo(403);
        assertThat(denied.body()).contains("ACCESS_DENIED");
    }

    @Test
    void lecturerSessionReachesActiveGeofencesThroughTheProxy() throws Exception {
        grantRole("role-lecturer");
        String sessionCookie = establishSession();
        Map<String, String> headers = edgePortal();
        headers.put("Cookie", sessionCookie);
        HttpResponse<String> response = get(BASE + "/bff/api/attendance/geofences/active", headers);
        assertThat(response.statusCode()).as("lecturer active-geofences: %s", response.body())
                .isEqualTo(200);
        assertThat(response.body()).startsWith("[");
    }

    @Test
    void adminSessionReachesGeofenceListThroughTheProxy() throws Exception {
        grantRole("role-admin");
        String sessionCookie = establishSession();
        Map<String, String> headers = edgePortal();
        headers.put("Cookie", sessionCookie);
        HttpResponse<String> response = get(BASE + "/bff/api/admin/attendance/geofences", headers);
        assertThat(response.statusCode()).as("admin geofence list: %s", response.body())
                .isEqualTo(200);
        assertThat(response.body()).startsWith("[");
    }

    // ---- helpers -----------------------------------------------------------

    private void grantRole(String roleId) {
        jdbc.update("INSERT INTO campuscore_auth.\"UserRole\" (\"id\", \"userId\", \"roleId\")"
                + " VALUES ('ur-patch-test', 'student-user', ?)", roleId);
    }

    private String csrfFor(String cookie) throws Exception {
        Map<String, String> headers = edgePortal();
        headers.put("Cookie", cookie);
        HttpResponse<String> response = get(BASE + "/session/state", headers);
        assertThat(response.statusCode()).isEqualTo(200);
        return mapper.readTree(response.body()).get("csrfToken").asText();
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

    /**
     * Local upstream for the PATCH round trip: a plain servlet filter (not a
     * controller, so route inventories never see it) registered after the
     * security chain — only a fully authenticated, surface-credentialed
     * loopback request reaches it. It answers the request itself, so the
     * mapped path can never collide with a real handler; the URI sits under
     * the production-allowlisted /api/v1/notifications prefix so the proxy
     * gate exercised here is the exact application.yml list. It reports the
     * delivered verb, body, and credential presence without echoing any
     * secret value.
     */
    @TestConfiguration(proxyBeanMethods = false)
    static class PatchProbeConfiguration {

        @Bean
        FilterRegistrationBean<jakarta.servlet.Filter> bffPatchProbe() {
            FilterRegistrationBean<jakarta.servlet.Filter> registration =
                    new FilterRegistrationBean<>();
            registration.setFilter((request, response, chain) -> {
                jakarta.servlet.http.HttpServletRequest httpRequest =
                        (jakarta.servlet.http.HttpServletRequest) request;
                jakarta.servlet.http.HttpServletResponse httpResponse =
                        (jakarta.servlet.http.HttpServletResponse) response;
                httpResponse.setStatus(200);
                httpResponse.setContentType("text/plain;charset=UTF-8");
                httpResponse.setHeader("X-Probe-Echo", "patch-echo");
                String body = new String(httpRequest.getInputStream().readAllBytes(),
                        StandardCharsets.UTF_8);
                httpResponse.getWriter().write(
                        "method=" + httpRequest.getMethod()
                                + "\nauthorized=" + (httpRequest.getHeader("Authorization") != null)
                                + "\nsurface=" + httpRequest.getHeader("X-Campuscore-Surface")
                                + "\nbody=" + body);
            });
            registration.addUrlPatterns("/api/v1/notifications/bff-patch-probe");
            registration.setOrder(Ordered.LOWEST_PRECEDENCE);
            return registration;
        }
    }
}
