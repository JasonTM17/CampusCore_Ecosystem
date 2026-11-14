package io.campuscore.restfulapi.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletRequest;

class CookieOrBearerTokenResolverTest {

    private static final String COOKIE_NAME = "cc_access_token";

    private final CookieOrBearerTokenResolver resolver = new CookieOrBearerTokenResolver(COOKIE_NAME);

    @Test
    void resolvesBearerHeaderFirst() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader(HttpHeaders.AUTHORIZATION, "Bearer bearer-token-1");

        assertEquals("bearer-token-1", resolver.resolve(request));
    }

    @Test
    void bearerHeaderWinsOverCookie() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader(HttpHeaders.AUTHORIZATION, "Bearer bearer-token-2");
        request.setCookies(new Cookie(COOKIE_NAME, "cookie-token"));

        assertEquals("bearer-token-2", resolver.resolve(request));
    }

    @Test
    void fallsBackToAccessTokenCookie() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(new Cookie(COOKIE_NAME, "cookie-token-3"));

        assertEquals("cookie-token-3", resolver.resolve(request));
    }

    @Test
    void returnsNullWithoutCredentials() {
        assertNull(resolver.resolve(new MockHttpServletRequest()));
    }

    @Test
    void ignoresUnrelatedCookies() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(new Cookie("other_cookie", "value"), new Cookie("session", "abc"));

        assertNull(resolver.resolve(request));
    }

    @Test
    void ignoresBlankCookieValue() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(new Cookie(COOKIE_NAME, "   "));

        assertNull(resolver.resolve(request));
    }

    @Test
    void honorsConfiguredCookieName() {
        CookieOrBearerTokenResolver custom = new CookieOrBearerTokenResolver("custom_token");
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(new Cookie("custom_token", "custom-cookie-token"), new Cookie(COOKIE_NAME, "ignored"));

        assertEquals("custom-cookie-token", custom.resolve(request));
    }

    @Test
    void ignoresMalformedAuthorizationHeader() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader(HttpHeaders.AUTHORIZATION, "NotBearer token");
        request.setCookies(new Cookie(COOKIE_NAME, "cookie-token-4"));

        assertEquals("cookie-token-4", resolver.resolve(request));
    }
}
