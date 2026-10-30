package io.campuscore.restfulapi.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * Rendered login-page regression: the OIDC chain serves this HTML to every
 * unauthenticated browser, but endpoint tests only cover the JSON authority
 * underneath it. Two shipped-page invariants are asserted here on the real
 * document — the two-factor branch must leave the OTP input visible and
 * focusable (a CSS rule hid the input itself while only the wrapper was
 * revealed), and both credential fetches must echo the readable CSRF hint
 * whenever the central session cookies already sit in the jar (a revisit or
 * refresh-only cookie used to answer 403 CSRF_INVALID).
 */
@SpringBootTest
@AutoConfigureMockMvc(print = org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint.NONE)
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "identity.oidc.enabled=true",
        "identity.oidc.dev-keygen=true",
        "identity.oidc.issuer-uri=http://127.0.0.1:4010",
        "identity.oidc.token-encryption-key=dGVzdC1rZXktMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY=",
        "identity.clients[0].client-id=cu-hub",
        "identity.clients[0].client-secret=it-secret-0123456789abcdef0123456789",
        "identity.clients[0].redirect-uris[0]=http://127.0.0.1:3100/session/callback",
        "identity.clients[0].post-logout-redirect-uris[0]=http://127.0.0.1:3100/",
        "identity.clients[0].scopes[0]=openid",
        "identity.clients[0].scopes[1]=profile",
        "identity.clients[0].scopes[2]=email",
        "identity.clients[0].access-token-ttl=PT15M",
        "identity.clients[0].refresh-token-ttl=P7D"
})
class IdentityLoginPageRenderTest {

    @Autowired private MockMvc mvc;

    private Document render() throws Exception {
        MvcResult result = mvc.perform(get("/login"))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(result.getResponse().getHeader("Content-Type")).contains("text/html");
        return Jsoup.parse(result.getResponse().getContentAsString());
    }

    @Test
    void otpInputBecomesVisibleWhenTwoFactorBranchRuns() throws Exception {
        Document page = render();
        Element otp = page.selectFirst("#otp");
        Element wrap = page.selectFirst("#otpWrap");
        assertThat(otp).as("OTP input exists on the page").isNotNull();
        assertThat(wrap).as("OTP wrapper exists on the page").isNotNull();
        // The wrapper is the only initially-hidden layer; entering the
        // two-factor branch reveals it and focuses the input.
        assertThat(wrap.attr("style")).contains("display:none");
        assertThat(otp.attr("type")).isNotEqualTo("hidden");
        assertThat(otp.hasAttr("disabled")).isFalse();

        // No stylesheet rule may pin the input itself to display:none —
        // that is what left it invisible after the wrapper was revealed.
        String style = page.selectFirst("style").data();
        Matcher hidden = Pattern.compile("([^{}]+)\\{([^{}]*display\\s*:\\s*none[^{}]*)\\}")
                .matcher(style);
        while (hidden.find()) {
            for (String selector : hidden.group(1).split(",")) {
                assertThat(selector.trim())
                        .as("display:none rule must not target the OTP input itself: %s", hidden.group(1))
                        .isNotEqualTo("#otp");
            }
        }

        // Simulate the branch: the script sets the wrapper visible and moves
        // focus — after which nothing left in the DOM keeps #otp unfocusable.
        String script = page.select("script").html();
        assertThat(script).contains("otpWrap.style.display");
        assertThat(script).contains("getElementById('otp').focus()");
        wrap.attr("style", "display:block");
        boolean hiddenByAncestor = false;
        for (Element node = otp; node != null; node = node.parent()) {
            if (node.attr("style").replace(" ", "").contains("display:none")) {
                hiddenByAncestor = true;
            }
        }
        assertThat(hiddenByAncestor)
                .as("OTP input stays hidden after the two-factor branch reveals its wrapper")
                .isFalse();
    }

    @Test
    void bothCredentialFetchesEchoTheCsrfHintCookie() throws Exception {
        Document page = render();
        String script = page.select("script").html();

        // The page reads the readable double-submit hint and attaches it as
        // the configured header on every same-origin credential POST.
        assertThat(script).contains("cc_csrf");
        assertThat(script).contains("X-CSRF-Token");

        for (String path : new String[]{"/api/v1/auth/login", "/api/v1/auth/two-factor/verify"}) {
            Matcher call = Pattern.compile(
                    "fetch\\('" + Pattern.quote(path) + "'\\s*,\\s*\\{([^}]*)\\}")
                    .matcher(script);
            assertThat(call.find()).as("fetch call exists: %s", path).isTrue();
            String headersExpression = call.group(1);
            // The header object must come from the CSRF-aware builder, not a
            // literal that only carries Content-Type.
            Matcher builder = Pattern.compile("headers\\s*:\\s*(\\w+)\\(\\)").matcher(headersExpression);
            assertThat(builder.find()).as("fetch headers built for %s", path).isTrue();
            String builderName = builder.group(1);
            int start = script.indexOf("function " + builderName + "(");
            assertThat(start).as("header builder defined: %s", builderName).isGreaterThanOrEqualTo(0);
            int end = script.indexOf("function", start + 1);
            String definition = script.substring(start, end == -1 ? script.length() : end);
            assertThat(definition).contains("cc_csrf").contains("X-CSRF-Token");
        }
    }

    @Test
    void loginPageKeepsItsNoStoreAndCspContract() throws Exception {
        MvcResult result = mvc.perform(get("/login"))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(result.getResponse().getHeader("Cache-Control")).isEqualTo("no-store");
        assertThat(result.getResponse().getHeader("Content-Security-Policy"))
                .contains("default-src 'none'")
                .contains("connect-src 'self'")
                .contains("frame-ancestors 'none'");
    }
}
