package io.campuscore.restfulapi.identity;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Authorize-paused contract (identity-contract.md §2.5): only the authorize
 * endpoint returns 503; token/jwks/discovery stay alive so existing grants
 * can still refresh or be revoked during recovery.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "identity.oidc.enabled=true",
        "identity.oidc.authorize-paused=true",
        "identity.oidc.dev-keygen=true",
        "identity.oidc.issuer-uri=http://127.0.0.1:4010",
        "identity.oidc.token-encryption-key=dGVzdC1rZXktMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY=",
        "identity.clients[0].client-id=cu-hub",
        "identity.clients[0].client-secret=it-secret-0123456789abcdef0123456789",
        "identity.clients[0].redirect-uris[0]=http://127.0.0.1:3100/session/callback",
        "identity.clients[0].post-logout-redirect-uris[0]=http://127.0.0.1:3100/",
        "identity.clients[0].scopes[0]=openid"
})
class EcosystemIdentityPausedContractTest {

    @Autowired private MockMvc mvc;

    @Test
    void authorizeReturns503WhileOtherEndpointsLive() throws Exception {
        mvc.perform(get("/oauth2/authorize")
                        .queryParam("response_type", "code")
                        .queryParam("client_id", "cu-hub")
                        .queryParam("redirect_uri", "http://127.0.0.1:3100/session/callback")
                        .queryParam("scope", "openid")
                        .queryParam("code_challenge", "x")
                        .queryParam("code_challenge_method", "S256"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("AUTHORIZE_PAUSED"));
        mvc.perform(get("/oauth2/jwks")).andExpect(status().isOk());
        mvc.perform(get("/.well-known/openid-configuration")).andExpect(status().isOk());
        // Token endpoint still answers (client-auth error here is fine —
        // the point is the endpoint exists).
        mvc.perform(post("/oauth2/token")
                        .with(httpBasic("cu-hub", "it-secret-0123456789abcdef0123456789"))
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("grant_type", "authorization_code")
                        .param("code", "bogus"))
                .andExpect(status().is4xxClientError());
    }
}
