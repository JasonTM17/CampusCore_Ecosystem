package io.campuscore.restfulapi.thesis.assistant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import com.sun.net.httpserver.HttpServer;
import tools.jackson.databind.ObjectMapper;
import io.campuscore.restfulapi.web.DomainException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import java.net.http.HttpClient;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

class AssistantKnowledgeAuthorityGatewayTest {
    private static final String ASSERTION_SECRET = "knowledge-gateway-test-owner-assertion-key";
    private HttpServer server;

    @AfterEach
    void cleanup() {
        SecurityContextHolder.clearContext();
        if (server != null) server.stop(0);
    }

    @Test
    void authenticatedAdminGatewaySendsDistinctKnowledgeAdminAssertion() throws Exception {
        AtomicReference<String> token = new AtomicReference<>();
        AtomicReference<String> owner = new AtomicReference<>();
        AtomicReference<String> assertion = new AtomicReference<>();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal/rag/assistant/knowledge", exchange -> {
            token.set(exchange.getRequestHeaders().getFirst("X-Rag-Service-Token"));
            owner.set(exchange.getRequestHeaders().getFirst("X-Assistant-Owner"));
            assertion.set(exchange.getRequestHeaders().getFirst(AssistantOwnerAssertion.HEADER));
            byte[] body = "[]".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        AssistantRagProperties properties = properties("http://127.0.0.1:"
                + server.getAddress().getPort() + "/internal/rag/assistant");
        AssistantKnowledgeAuthorityGateway gateway = new AssistantKnowledgeAuthorityGateway(properties, new ObjectMapper());
        authenticate("admin-a", "ROLE_ADMIN");

        assertEquals(List.of(), gateway.list("admin-a", null, null));
        assertEquals("internal-token", token.get());
        assertEquals("admin-a", owner.get());
        assertEquals("admin-a", new AssistantOwnerAssertion(properties)
                .verifyKnowledgeAdmin(assertion.get(), "admin-a"));
    }

    @Test
    void nonAdminAndMismatchedActorCannotMintKnowledgeAdminAssertion() {
        AssistantRagProperties properties = properties("http://127.0.0.1:4011/internal/rag/assistant");
        HttpClient http = mock(HttpClient.class);
        AssistantKnowledgeAuthorityGateway gateway = new AssistantKnowledgeAuthorityGateway(
                properties, new ObjectMapper(), http);

        authenticate("staff-a", "ROLE_USER");
        DomainException nonAdmin = assertThrows(DomainException.class,
                () -> gateway.list("staff-a", null, null));
        assertEquals("ACCESS_DENIED", nonAdmin.code());

        authenticate("admin-a", "ROLE_ADMIN");
        DomainException mismatchedActor = assertThrows(DomainException.class,
                () -> gateway.list("admin-b", null, null));
        assertEquals("ACCESS_DENIED", mismatchedActor.code());
        verifyNoInteractions(http);
    }

    private static AssistantRagProperties properties(String baseUrl) {
        return new AssistantRagProperties(baseUrl, "internal-token", ASSERTION_SECRET,
                true, 1_000, 5_000);
    }

    private static void authenticate(String subject, String role) {
        Jwt jwt = Jwt.withTokenValue("fixture").header("alg", "none").subject(subject).build();
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt,
                List.of(new SimpleGrantedAuthority(role))));
    }
}
