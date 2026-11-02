package io.campuscore.restfulapi.identity.bff;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

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
 * Body ceilings on the business proxy, exercised over the real HTTP stack with
 * the same wiring as the other BFF transport tests. The proxy must refuse an
 * oversized body itself instead of buffering whatever the browser sends (the
 * JSON filter only covers JSON content types, and servlet multipart limits only
 * apply once a part is parsed), while still forwarding every allowed route's
 * legitimate payloads and upstream responses.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.DEFINED_PORT,
        properties = {"server.port=14012"})
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "server.port=14012",
        "app.rate-limit.proxy-token=e2e-proxy-token-0123456789",
        "app.cors.allowed-origin-patterns=http://portal.test,http://learn.test,http://campus.test",
        "identity.oidc.enabled=true",
        "identity.oidc.dev-keygen=true",
        "identity.oidc.issuer-uri=http://127.0.0.1:14012",
        "identity.oidc.token-encryption-key=dGVzdC1rZXktMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY=",
        "identity.bff.enabled=true",
        "identity.bff.dev-http=true",
        "identity.bff.issuer-loopback=http://127.0.0.1:14012",
        "identity.bff.issuer-public=http://127.0.0.1:14012",
        "identity.bff.public-api-allowlist[0]=/api/v1/public/docs",
        // Smaller than the production 21 MB so the ceiling paths are cheap to
        // exercise; the proxy reads this same property.
        "spring.servlet.multipart.max-file-size=1MB",
        "spring.servlet.multipart.max-request-size=2MB",
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
class BffProxyBodyCapTest {

    private static final String BASE = "http://127.0.0.1:14012";
    private static final String PROXY_TOKEN = "e2e-proxy-token-0123456789";
    private static final String PASSWORD = "it-bff-password-1";
    private static final String SESSION_COOKIE = "cu_session_dev";
    private static final String TX_PREFIX = "cu_bff_tx_dev_";
    // Ceiling for every non-multipart body, and the multipart request ceiling
    // configured for this test context.
    private static final long PLAIN_BODY_CEILING = 1024L * 1024;
    private static final long MULTIPART_CEILING = 2L * 1024 * 1024;
    private static final int CHUNK = 8192;

    private static final AtomicBoolean PROBE_HIT = new AtomicBoolean();
    private static final AtomicLong PROBE_BYTES = new AtomicLong();

    private final HttpClient http = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NEVER).build();
    private final JdbcTemplate jdbc;
    @Autowired private ObjectMapper mapper;
    @Autowired private PasswordEncoder passwordEncoder;

    BffProxyBodyCapTest(@Autowired javax.sql.DataSource dataSource) {
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
        PROBE_HIT.set(false);
        PROBE_BYTES.set(0);
    }

    @Test
    void chunkedBodyAboveTheCeilingIsRejectedBeforeItReachesUpstream() throws Exception {
        String cookie = establishSession();
        HttpResponse<String> response = send("PUT", "/bff/api/notifications/bff-body-cap-probe",
                cookie, csrfFor(cookie), "application/octet-stream",
                streamingBody(PLAIN_BODY_CEILING + 1));

        assertThat(response.statusCode()).as("oversize chunked body: %s", response.body())
                .isEqualTo(413);
        assertThat(response.body()).contains("REQUEST_BODY_TOO_LARGE");
        assertThat(PROBE_HIT).as("an oversized body must not reach the upstream").isFalse();
    }

    @Test
    void declaredBodyAboveTheCeilingIsRejectedWithoutForwarding() throws Exception {
        String cookie = establishSession();
        byte[] body = new byte[(int) PLAIN_BODY_CEILING + 1];
        HttpResponse<String> response = send("PUT", "/bff/api/notifications/bff-body-cap-probe",
                cookie, csrfFor(cookie), "application/octet-stream",
                HttpRequest.BodyPublishers.ofByteArray(body));

        assertThat(response.statusCode()).as("oversize declared body: %s", response.body())
                .isEqualTo(413);
        assertThat(response.body()).contains("REQUEST_BODY_TOO_LARGE");
        assertThat(PROBE_HIT).as("an oversized body must not reach the upstream").isFalse();
    }

    @Test
    void multipartBodyAboveThePlainCeilingIsForwardedIntact() throws Exception {
        String cookie = establishSession();
        byte[] body = new byte[(int) (PLAIN_BODY_CEILING + 512 * 1024)];
        Arrays.fill(body, (byte) 'm');
        HttpResponse<String> response = send("PUT", "/bff/api/notifications/bff-body-cap-probe",
                cookie, csrfFor(cookie), "multipart/form-data; boundary=cap-test",
                HttpRequest.BodyPublishers.ofByteArray(body));

        assertThat(response.statusCode()).as("multipart under its ceiling: %s", response.body())
                .isEqualTo(200);
        assertThat(PROBE_BYTES).as("multipart body must arrive byte-for-byte").hasValue(body.length);
    }

    @Test
    void upstreamResponseAboveTheCeilingIsNotBuffered() throws Exception {
        String cookie = establishSession();
        HttpResponse<String> response = get(BASE
                + "/bff/api/notifications/bff-response-cap-probe?bytes=" + (MULTIPART_CEILING + 1),
                cookie);

        assertThat(response.statusCode()).as("oversize upstream response: %s",
                response.body().length() > 200 ? response.body().substring(0, 200) : response.body())
                .isEqualTo(502);
        assertThat(response.body()).contains("UPSTREAM_RESPONSE_TOO_LARGE");
    }

    @Test
    void upstreamResponseAtTheCeilingIsForwarded() throws Exception {
        String cookie = establishSession();
        HttpResponse<String> response = get(BASE
                + "/bff/api/notifications/bff-response-cap-probe?bytes=" + MULTIPART_CEILING,
                cookie);

        assertThat(response.statusCode()).as("upstream response at the ceiling: %s",
                response.body().length() > 200 ? response.body().substring(0, 200) : response.body())
                .isEqualTo(200);
        assertThat(response.body()).hasSize((int) MULTIPART_CEILING);
    }

    // ---- helpers -----------------------------------------------------------

    private HttpResponse<String> send(String method, String path, String cookie, String csrf,
            String contentType, HttpRequest.BodyPublisher body) throws Exception {
        return http.send(HttpRequest.newBuilder()
                .uri(URI.create(BASE + path))
                .header("X-Campuscore-Proxy-Token", PROXY_TOKEN)
                .header("X-Campuscore-Surface", "portal")
                .header("X-Campuscore-Scheme", "http")
                .header("X-Campuscore-Host", "portal.test")
                .header("Origin", "http://portal.test")
                .header("Sec-Fetch-Site", "same-origin")
                .header("Cookie", cookie)
                .header("x-csrf-token", csrf)
                .header("Content-Type", contentType)
                .method(method, body)
                .build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> get(String url, String cookie) throws Exception {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("X-Campuscore-Proxy-Token", PROXY_TOKEN);
        headers.put("X-Campuscore-Surface", "portal");
        headers.put("X-Campuscore-Scheme", "http");
        headers.put("X-Campuscore-Host", "portal.test");
        headers.put("Cookie", cookie);
        HttpRequest.Builder builder = HttpRequest.newBuilder().uri(URI.create(url));
        headers.forEach(builder::header);
        return http.send(builder.GET().build(), HttpResponse.BodyHandlers.ofString());
    }

    /** Chunked body source: no declared length, generated as it is read. */
    private static HttpRequest.BodyPublisher streamingBody(long bytes) {
        return HttpRequest.BodyPublishers.ofInputStream(() -> new InputStream() {
            private long remaining = bytes;

            @Override
            public int read() {
                if (remaining <= 0) {
                    return -1;
                }
                remaining--;
                return 'c';
            }

            @Override
            public int read(byte[] target, int offset, int length) {
                if (remaining <= 0) {
                    return -1;
                }
                int read = (int) Math.min(Math.min(length, CHUNK), remaining);
                Arrays.fill(target, offset, offset + read, (byte) 'c');
                remaining -= read;
                return read;
            }
        });
    }

    private String csrfFor(String cookie) throws Exception {
        Map<String, String> headers = edgePortal();
        headers.put("Cookie", cookie);
        HttpResponse<String> response = get(BASE + "/session/state", headers);
        assertThat(response.statusCode()).isEqualTo(200);
        return mapper.readTree(response.body()).get("csrfToken").asText();
    }

    private static Map<String, String> edgePortal() {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("X-Campuscore-Proxy-Token", PROXY_TOKEN);
        headers.put("X-Campuscore-Surface", "portal");
        headers.put("X-Campuscore-Scheme", "http");
        headers.put("X-Campuscore-Host", "portal.test");
        return headers;
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

    private static String setCookie(HttpResponse<?> response, String nameOrPrefix) {
        for (String header : response.headers().allValues("Set-Cookie")) {
            if (header.startsWith(nameOrPrefix)) {
                int semi = header.indexOf(';');
                return semi > 0 ? header.substring(0, semi) : header;
            }
        }
        return null;
    }

    private HttpResponse<String> get(String url, Map<String, String> headers) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder().uri(URI.create(url));
        headers.forEach(builder::header);
        return http.send(builder.GET().build(), HttpResponse.BodyHandlers.ofString());
    }

    /**
     * Local upstream probes. Plain servlet filters (not controllers) keep the
     * route inventories untouched; they only answer after the resource chain
     * authenticated the loopback request, and their paths sit under the
     * production-allowlisted /api/v1/notifications prefix.
     */
    @TestConfiguration(proxyBeanMethods = false)
    static class BodyCapProbeConfiguration {

        @Bean
        FilterRegistrationBean<jakarta.servlet.Filter> bffBodyCapProbe() {
            FilterRegistrationBean<jakarta.servlet.Filter> registration =
                    new FilterRegistrationBean<>();
            registration.setFilter((request, response, chain) -> {
                jakarta.servlet.http.HttpServletRequest httpRequest =
                        (jakarta.servlet.http.HttpServletRequest) request;
                jakarta.servlet.http.HttpServletResponse httpResponse =
                        (jakarta.servlet.http.HttpServletResponse) response;
                PROBE_HIT.set(true);
                long bytes = httpRequest.getInputStream().transferTo(
                        java.io.OutputStream.nullOutputStream());
                PROBE_BYTES.set(bytes);
                httpResponse.setStatus(200);
                httpResponse.setContentType("text/plain;charset=UTF-8");
                httpResponse.getWriter().write("forwarded=" + bytes);
            });
            registration.addUrlPatterns("/api/v1/notifications/bff-body-cap-probe");
            registration.setOrder(Ordered.LOWEST_PRECEDENCE);
            return registration;
        }

        @Bean
        FilterRegistrationBean<jakarta.servlet.Filter> bffResponseCapProbe() {
            FilterRegistrationBean<jakarta.servlet.Filter> registration =
                    new FilterRegistrationBean<>();
            registration.setFilter((request, response, chain) -> {
                jakarta.servlet.http.HttpServletRequest httpRequest =
                        (jakarta.servlet.http.HttpServletRequest) request;
                jakarta.servlet.http.HttpServletResponse httpResponse =
                        (jakarta.servlet.http.HttpServletResponse) response;
                int bytes = Integer.parseInt(httpRequest.getParameter("bytes"));
                httpResponse.setStatus(200);
                httpResponse.setContentType("application/octet-stream");
                byte[] chunk = new byte[CHUNK];
                java.io.OutputStream out = httpResponse.getOutputStream();
                for (int written = 0; written < bytes; ) {
                    int length = Math.min(chunk.length, bytes - written);
                    out.write(chunk, 0, length);
                    written += length;
                }
                out.flush();
            });
            registration.addUrlPatterns("/api/v1/notifications/bff-response-cap-probe");
            registration.setOrder(Ordered.LOWEST_PRECEDENCE);
            return registration;
        }
    }
}
