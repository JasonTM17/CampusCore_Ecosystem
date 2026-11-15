package io.campuscore.restfulapi.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** The enrollment container must serve only its registrarial slice. */
class EnrollmentSliceFilterTest {

    private final EnrollmentSliceFilter filter = new EnrollmentSliceFilter();

    @ParameterizedTest
    @ValueSource(strings = {
        "/api/v1/me/registration",
        "/api/v1/me/registration/rounds",
        "/api/v1/me/registration/enrollments/x",
        "/api/v1/me/enrollments",
        "/api/v1/me/enrollments/abc",
        "/api/v1/admin/registration/rounds",
        "/api/v1/health/liveness",
        "/api/v1/health/readiness",
    })
    void allowlistedRoutesPassThrough(String path) throws Exception {
        MockHttpServletResponse response = dispatch("GET", path);
        assertEquals(204, response.getStatus(), path);
        assertFalse(response.getContentAsString().contains("ENROLLMENT_API_SLICE"), path);
        assertEquals(EnrollmentSliceFilter.SERVED_BY_VALUE,
                response.getHeader(EnrollmentSliceFilter.SERVED_BY_HEADER));
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "/api/v1/me/notifications",
        "/api/v1/me/grades",
        "/api/v1/me/bursar/account",
        "/api/v1/admin/users",
        "/api/v1/assistant/chat",
        "/api/v1/me/registrationx",
        "/api/v1/me/enrollmentsx",
        "/",
    })
    void otherRoutesAnswer404WithSliceCode(String path) throws Exception {
        MockHttpServletResponse response = dispatch("GET", path);
        assertEquals(404, response.getStatus(), path);
        assertEquals(EnrollmentSliceFilter.SERVED_BY_VALUE,
                response.getHeader(EnrollmentSliceFilter.SERVED_BY_HEADER));
        assertTrue(response.getContentAsString().contains("ENROLLMENT_API_SLICE"), path);
    }

    @Test
    void optionsPreflightAlwaysPassesThrough() throws Exception {
        MockHttpServletResponse response = dispatch("OPTIONS", "/api/v1/me/notifications");
        assertFalse(response.getContentAsString().contains("ENROLLMENT_API_SLICE"));
        assertEquals(EnrollmentSliceFilter.SERVED_BY_VALUE,
                response.getHeader(EnrollmentSliceFilter.SERVED_BY_HEADER));
    }

    private MockHttpServletResponse dispatch(String method, String path) throws IOException, jakarta.servlet.ServletException {
        MockHttpServletRequest request = new MockHttpServletRequest(method, path);
        request.setRequestURI(path);
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = (servletRequest, servletResponse) ->
                ((HttpServletResponse) servletResponse).setStatus(204);
        filter.doFilter(request, response, chain);
        return response;
    }

}
