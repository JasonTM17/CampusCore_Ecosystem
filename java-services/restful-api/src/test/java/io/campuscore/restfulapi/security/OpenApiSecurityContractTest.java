package io.campuscore.restfulapi.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"test", "persistence"})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:openapi_accuracy;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "identity.oidc.enabled=true",
        "identity.oidc.dev-keygen=true",
        "identity.oidc.issuer-uri=http://127.0.0.1:4010",
        "identity.oidc.token-encryption-key=dGVzdC1rZXktMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY=",
        "identity.bff.enabled=true",
        "identity.bff.dev-http=true",
        "identity.bff.surfaces[0].id=portal",
        "identity.bff.surfaces[0].mode=BFF",
        "identity.bff.surfaces[0].client-id=cu-portal",
        "identity.bff.surfaces[0].client-secret=bff-portal-secret-0123456789abcdef",
        "identity.bff.surfaces[0].proxy-secret=proxy-portal-secret-0123456789ab",
        "identity.bff.surfaces[0].public-base-url=http://portal.test",
        "identity.bff.surfaces[0].hosts[0]=portal.test"
})
class OpenApiSecurityContractTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void publicOperationsOverrideTheGlobalBearerRequirement() throws Exception {
        JsonNode spec = openApiDocument();
        List<String> securedPublicOperations = new ArrayList<>();

        for (Map.Entry<String, JsonNode> path : spec.path("paths").properties()) {
            for (Map.Entry<String, JsonNode> method : path.getValue().properties()) {
                if (!method.getKey().matches("get|put|post|delete|patch|head|options|trace")) {
                    continue;
                }

                HttpMethod httpMethod = HttpMethod.valueOf(method.getKey().toUpperCase(Locale.ROOT));
                MockHttpServletRequest request = new MockHttpServletRequest(httpMethod.name(), path.getKey());
                request.setRequestURI(path.getKey());
                request.setServletPath(path.getKey());
                boolean publicEndpoint = SecurityConfig.publicEndpoints().stream()
                        .anyMatch(endpoint -> endpoint.matcher().matches(request));
                if (!publicEndpoint) {
                    continue;
                }

                JsonNode security = method.getValue().path("security");
                if (!security.isArray() || !security.isEmpty()) {
                    securedPublicOperations.add(httpMethod.name() + " " + path.getKey());
                }
            }
        }

        assertThat(securedPublicOperations)
                .as("permitAll operations must explicitly override the global bearer requirement")
                .isEmpty();
    }

    private JsonNode openApiDocument() throws Exception {
        var result = mvc.perform(get("/v3/api-docs").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString());
    }
}
