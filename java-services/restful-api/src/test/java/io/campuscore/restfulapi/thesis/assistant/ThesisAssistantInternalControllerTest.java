package io.campuscore.restfulapi.thesis.assistant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import io.campuscore.restfulapi.thesis.assistant.ThesisAssistantDtos.ChatRequest;
import io.campuscore.restfulapi.thesis.assistant.ThesisAssistantDtos.ChatResponse;
import io.campuscore.restfulapi.web.DomainException;
import java.util.List;
import java.util.ArrayList;
import java.util.concurrent.Executor;
import java.util.concurrent.FutureTask;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

class ThesisAssistantInternalControllerTest {
    private static final String ASSERTION_SECRET = "unit-test-owner-assertion-secret-material";

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void rawOwnerHeaderCannotAuthorizeAnInternalAssistantCall() {
        ThesisAssistantService service = Mockito.mock(ThesisAssistantService.class);
        ThesisAssistantInternalController controller = controller(service);

        DomainException failure = assertThrows(DomainException.class,
                () -> controller.chat(new ChatRequest("Xin chào", "vi"), "internal-token", null, "victim-owner"));

        assertEquals(org.springframework.http.HttpStatus.FORBIDDEN, failure.status());
        verifyNoInteractions(service);
    }

    @Test
    void internalOwnerScopeIsClearedBetweenTasksIncludingFailedGeneration() {
        ThesisAssistantService service = Mockito.mock(ThesisAssistantService.class);
        List<Runnable> tasks = new ArrayList<>();
        Executor controlledExecutor = tasks::add;
        var controller = new ThesisAssistantInternalController(service,
                properties("internal-token"), controlledExecutor);
        List<AssistantRlsContext.Identity> identities = new ArrayList<>();
        Mockito.doAnswer(invocation -> {
            identities.add(AssistantRlsContext.current());
            if (identities.size() == 2) throw new DomainException(
                    org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, "ASSISTANT_UNAVAILABLE", "Unavailable");
            return null;
        }).when(service).stream(anyString(), anyString(), any(), anyString(), any(), any(), any());
        for (String owner : List.of("owner-a", "owner-b")) {
            controller.stream(new ChatRequest("Quy chế học vụ", "vi"), "internal-token", assertion(owner), owner);
            Runnable task = tasks.remove(0);
            task.run();
            assertEquals(null, AssistantRlsContext.current());
            assertTrue(!((FutureTask<?>) task).isCancelled());
        }
        assertEquals("owner-a", identities.get(0).ownerId());
        assertEquals("owner-b", identities.get(1).ownerId());
        assertEquals(AssistantRlsContext.Scope.INTERNAL_OWNER, identities.get(0).scope());
        assertEquals(AssistantRlsContext.Scope.INTERNAL_OWNER, identities.get(1).scope());
        assertTrue(!identities.get(0).admin() && !identities.get(1).admin());
    }

    @Test
    void invalidStreamTokenOrMissingOwnerNeverSubmitsAWorker() {
        ThesisAssistantService service = Mockito.mock(ThesisAssistantService.class);
        List<Runnable> tasks = new ArrayList<>();
        var controller = new ThesisAssistantInternalController(service,
                properties("internal-token"), tasks::add);
        ChatRequest request = new ChatRequest("Quy chế học vụ", "vi");
        assertEquals("RAG_SERVICE_UNAUTHORIZED", assertThrows(DomainException.class,
                () -> controller.stream(request, "wrong-token", null, "owner-a")).code());
        assertEquals("RAG_SERVICE_UNAUTHORIZED", assertThrows(DomainException.class,
                () -> controller.stream(request, null, null, "owner-a")).code());
        assertEquals("RAG_OWNER_ASSERTION_INVALID", assertThrows(DomainException.class,
                () -> controller.stream(request, "internal-token", null, null)).code());
        assertTrue(tasks.isEmpty());
        verifyNoInteractions(service);
    }

    @Test
    void httpStreamFlushesBeforeGenerationCompletesInTheVerifiedInternalOwnerScope() throws Exception {
        ThesisAssistantService service = Mockito.mock(ThesisAssistantService.class);
        AssistantStreamExecutor streams = new AssistantStreamExecutor("assistant-stream-test-", 1);
        var controller = new ThesisAssistantInternalController(service,
                properties("internal-token"), streams);
        var mvc = MockMvcBuilders.standaloneSetup(controller).build();
        CountDownLatch firstDeltaSent = new CountDownLatch(1);
        CountDownLatch releaseGeneration = new CountDownLatch(1);
        AtomicReference<AssistantRlsContext.Identity> identity = new AtomicReference<>();
        Mockito.doAnswer(invocation -> {
            Consumer<ThesisAssistantService.StreamEvent> sink = invocation.getArgument(5);
            identity.set(AssistantRlsContext.current());
            sink.accept(new ThesisAssistantService.StreamMeta(UUID.randomUUID(), invocation.getArgument(4),
                    null, null, "test-provider", "vi"));
            sink.accept(new ThesisAssistantService.StreamDelta(0, "first grounded answer", List.of()));
            firstDeltaSent.countDown();
            assertTrue(releaseGeneration.await(5, TimeUnit.SECONDS));
            sink.accept(new ThesisAssistantService.StreamDone(null, "ANSWERED", false, "COMPLETED"));
            return null;
        }).when(service).stream(anyString(), anyString(), any(), anyString(), any(), any(), any());
        var requests = Executors.newSingleThreadExecutor();
        try {
            String ownerAssertion = assertion("owner-a");
            var response = requests.submit(() -> mvc.perform(post("/internal/rag/assistant/chat/stream")
                    .header("X-Rag-Service-Token", "internal-token")
                    .header(AssistantOwnerAssertion.HEADER, ownerAssertion)
                    .header("X-Assistant-Owner", "owner-a")
                    .contentType("application/json")
                    .content("{\"message\":\"Quy chế học vụ\",\"locale\":\"vi\",\"clientRequestId\":\""
                            + UUID.randomUUID() + "\"}"))
                    .andReturn());
            assertTrue(firstDeltaSent.await(2, TimeUnit.SECONDS));
            var result = response.get(500, TimeUnit.MILLISECONDS);
            assertTrue(result.getRequest().isAsyncStarted());
            assertTrue(result.getResponse().getContentAsString().contains("first grounded answer"));
            assertEquals("owner-a", identity.get().ownerId());
            assertEquals(AssistantRlsContext.Scope.INTERNAL_OWNER, identity.get().scope());
            releaseGeneration.countDown();
            result.getAsyncResult(2_000);
            assertTrue(mvc.perform(asyncDispatch(result)).andReturn().getResponse()
                    .getContentAsString().contains("event:done"));
        } finally {
            releaseGeneration.countDown();
            requests.shutdownNow();
            assertTrue(requests.awaitTermination(2, TimeUnit.SECONDS));
            streams.close();
        }
    }

    @Test
    void bothInternalAssistantAliasesAcceptOnlyAValidSelfAssertion() throws Exception {
        ThesisAssistantService service = Mockito.mock(ThesisAssistantService.class);
        var controller = controller(service);
        var mvc = MockMvcBuilders.standaloneSetup(controller).build();
        ChatResponse expected = new ChatResponse("ok", "curated-lexical-rag", false, "ANSWERED", "en", List.of());
        UUID requestId = UUID.randomUUID();
        when(service.answer("hello", "en", null, "owner-a", requestId, (String) null)).thenReturn(expected);
        String assertion = assertion("owner-a");

        for (String alias : List.of("/internal/rag/assistant", "/internal/rag/thesis/assistant")) {
            var response = mvc.perform(post(alias + "/chat")
                    .header("X-Rag-Service-Token", "internal-token")
                    .header(AssistantOwnerAssertion.HEADER, assertion)
                    .header("X-Assistant-Owner", "owner-a")
                    .contentType("application/json")
                    .content("{\"message\":\"hello\",\"locale\":\"en\",\"clientRequestId\":\"" + requestId + "\"}"))
                    .andReturn()
                    .getResponse();
            assertEquals(200, response.getStatus());
        }
        verify(service, Mockito.times(2)).answer("hello", "en", null, "owner-a", requestId, (String) null);
    }

    @Test
    void rejectsMissingTokenBeforeCallingAssistantService() {
        ThesisAssistantService service = Mockito.mock(ThesisAssistantService.class);
        ThesisAssistantInternalController controller = controller(service);

        DomainException exception = assertThrows(DomainException.class,
                () -> controller.chat(new ChatRequest("Xin chào", "vi", UUID.randomUUID(), null), null, null, "owner-a"));

        assertEquals("RAG_SERVICE_UNAUTHORIZED", exception.code());
        verifyNoInteractions(service);
}
    @Test
    void rejectsMissingAssertionBeforeCallingAssistantService() {
        ThesisAssistantService service = Mockito.mock(ThesisAssistantService.class);
        ThesisAssistantInternalController controller = controller(service);

        DomainException exception = assertThrows(DomainException.class,
                () -> controller.chat(new ChatRequest("Xin chào", "vi", UUID.randomUUID(), null), "internal-token", null, null));

        assertEquals("RAG_OWNER_ASSERTION_INVALID", exception.code());
        verifyNoInteractions(service);
    }

    @Test
    void assertionSubjectMustMatchOwnerHeaderBeforeCallingAssistantService() {
        ThesisAssistantService service = Mockito.mock(ThesisAssistantService.class);
        ThesisAssistantInternalController controller = controller(service);

        DomainException failure = assertThrows(DomainException.class,
                () -> controller.chat(new ChatRequest("Xin chào", "vi"), "internal-token",
                        assertion("owner-a"), "owner-b"));

        assertEquals("RAG_OWNER_ASSERTION_INVALID", failure.code());
        verifyNoInteractions(service);
    }

    @Test
    void delegatesChatWithVerifiedInternalTokenAndOwner() {
        ThesisAssistantService service = Mockito.mock(ThesisAssistantService.class);
        ThesisAssistantInternalController controller = controller(service);
        UUID requestId = UUID.randomUUID();
        ChatRequest request = new ChatRequest("Xin chào", "vi", requestId, null);
        ChatResponse expected = new ChatResponse("ok", "curated-lexical-rag", false, "ANSWERED", "vi", List.of());
        when(service.answer("Xin chào", "vi", null, "owner-a", requestId, (String) null)).thenReturn(expected);

        ChatResponse response = controller.chat(request, "internal-token", assertion("owner-a"), "owner-a");

        assertEquals(expected, response);
        verify(service).answer("Xin chào", "vi", null, "owner-a", requestId, (String) null);
    }

    @Test
    void forwardsTheSpecializedScopeToTheAssistantService() {
        ThesisAssistantService service = Mockito.mock(ThesisAssistantService.class);
        ThesisAssistantInternalController controller = controller(service);
        UUID requestId = UUID.randomUUID();
        ChatRequest request = new ChatRequest("SOLID là gì?", "vi", requestId, null, "specialized");
        ChatResponse expected = new ChatResponse("ok", "curated-lexical-rag", false, "ANSWERED", "vi", List.of());
        when(service.answer("SOLID là gì?", "vi", null, "owner-a", requestId, "specialized"))
                .thenReturn(expected);

        ChatResponse response = controller.chat(request, "internal-token", assertion("owner-a"), "owner-a");

        assertEquals(expected, response);
        verify(service).answer("SOLID là gì?", "vi", null, "owner-a", requestId, "specialized");
    }

    @Test
    void committedDefaultTokensFailClosedUnderStrictModeAndPlaceholdersAlwaysFail() {
        ThesisAssistantService service = Mockito.mock(ThesisAssistantService.class);
        ChatRequest request = new ChatRequest("Xin chào", "vi", UUID.randomUUID(), null);

        // Strict secrets mode rejects the compose-shipped dev default.
        var strict = new ThesisAssistantInternalController(service,
                properties(AssistantRagProperties.DEV_COMPOSE_DEFAULT_TOKEN),
                Runnable::run, true);
        DomainException strictFailure = assertThrows(DomainException.class,
                () -> strict.chat(request, AssistantRagProperties.DEV_COMPOSE_DEFAULT_TOKEN, null, "owner-a"));
        assertEquals("RAG_SERVICE_TOKEN_MISSING", strictFailure.code());

        // The same token keeps working in dev mode (flag off).
        var devMode = new ThesisAssistantInternalController(service,
                properties(AssistantRagProperties.DEV_COMPOSE_DEFAULT_TOKEN),
                Runnable::run, false);
        ChatResponse expected = new ChatResponse("ok", "curated-lexical-rag", false, "ANSWERED", "vi", List.of());
        when(service.answer("Xin chào", "vi", null, "owner-a", request.clientRequestId(), (String) null))
                .thenReturn(expected);
        assertEquals(expected, devMode.chat(request, AssistantRagProperties.DEV_COMPOSE_DEFAULT_TOKEN,
                assertion("owner-a"), "owner-a"));
        Mockito.clearInvocations(service);

        // Placeholder tokens are rejected in every mode.
        var placeholder = new ThesisAssistantInternalController(service,
                properties("local-rag-service-token-change-me"),
                Runnable::run, false);
        DomainException placeholderFailure = assertThrows(DomainException.class,
                () -> placeholder.chat(request, "local-rag-service-token-change-me", null, "owner-a"));
        assertEquals("RAG_SERVICE_TOKEN_MISSING", placeholderFailure.code());
        verifyNoInteractions(service);
    }

    private ThesisAssistantInternalController controller(ThesisAssistantService service) {
        return new ThesisAssistantInternalController(service,
                properties("internal-token"));
    }

    private static AssistantRagProperties properties(String token) {
        return new AssistantRagProperties("", token, ASSERTION_SECRET, true, 1_000, 30_000);
    }

    private static String assertion(String subject) {
        Jwt jwt = Jwt.withTokenValue("fixture")
                .header("alg", "none")
                .subject(subject)
                .build();
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt, List.of()));
        return new AssistantOwnerAssertion(properties("internal-token")).issueAssistant(subject);
    }
}
