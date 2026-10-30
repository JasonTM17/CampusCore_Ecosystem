package io.campuscore.restfulapi.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import jakarta.servlet.http.Cookie;
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
 * Flag-off contract (identity-contract.md §2.5): {@code identity.oidc.enabled=false}
 * removes the entire SAS surface — authorize, token, jwks, discovery all
 * produce handler-miss 404 under an authenticated request (unauthenticated
 * requests are intercepted by the business chain's auth requirement first).
 * Legacy auth stays fully functional.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {"identity.oidc.enabled=false"})
class EcosystemIdentityDisabledContractTest {

    private static final String PASSWORD = "it-disabled-password-1";

    @Autowired private MockMvc mvc;
    private final JdbcTemplate jdbc;
    @Autowired private PasswordEncoder passwordEncoder;

    EcosystemIdentityDisabledContractTest(@Autowired javax.sql.DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    @BeforeEach
    void resetDemoAccount() {
        jdbc.update(
                "UPDATE campuscore_auth.\"User\" SET \"password\" = ?, \"status\" = 'ACTIVE'"
                        + " WHERE \"id\" = 'student-user'",
                passwordEncoder.encode(PASSWORD));
    }

    @Test
    void sasEndpointsDoNotExistWhenDisabled() throws Exception {
        MvcResult login = mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"student@campuscore.edu\",\"password\":\""
                                + PASSWORD + "\"}"))
                .andExpect(status().isOk())
                .andReturn();
        Cookie access = login.getResponse().getCookie("cc_access_token");
        assertThat(access).isNotNull();

        mvc.perform(get("/.well-known/openid-configuration").cookie(access))
                .andExpect(status().isNotFound());
        mvc.perform(get("/oauth2/jwks").cookie(access))
                .andExpect(status().isNotFound());
        mvc.perform(get("/oauth2/authorize").cookie(access)
                        .queryParam("response_type", "code")
                        .queryParam("client_id", "x"))
                .andExpect(status().isNotFound());
        // Unsafe method + session cookie: the app's double-submit CSRF
        // contract applies even on missing routes.
        mvc.perform(post("/oauth2/token")
                        .cookie(access, new Cookie("cc_csrf", "csrf-disabled-1"))
                        .header("X-CSRF-Token", "csrf-disabled-1")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("grant_type", "authorization_code"))
                .andExpect(status().isNotFound());
    }
}
