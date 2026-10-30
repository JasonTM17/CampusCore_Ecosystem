package io.campuscore.restfulapi.thesis.assistant;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.util.ReflectionTestUtils;

class AssistantMetricsContractTest {
    @Test
    void bothDirectHandoffPoolsObserveBusyWorkersZeroQueueAndRejections() throws Exception {
        var registry = new SimpleMeterRegistry();
        try {
            for (String prefix : List.of("assistant-stream-", "assistant-internal-stream-")) {
                try (var executor = new AssistantStreamExecutor(prefix, 1)) {
                    ReflectionTestUtils.invokeMethod(executor, "bindMetrics", registry);
                    String pool = prefix.contains("internal") ? "internal" : "student";
                    CountDownLatch entered = new CountDownLatch(1);
                    CountDownLatch release = new CountDownLatch(1);
                    try {
                        executor.execute(() -> {
                            entered.countDown();
                            try { release.await(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                        });
                        assertTrue(entered.await(3, TimeUnit.SECONDS));
                        assertEquals(1, registry.get("campuscore.assistant.executor.active").tag("executor", pool).gauge().value());
                        assertEquals(0, registry.get("campuscore.assistant.executor.queued").tag("executor", pool).gauge().value());
                        assertThrows(RejectedExecutionException.class, () -> executor.execute(() -> {}));
                        assertEquals(1, registry.get("campuscore.assistant.executor.rejected").tag("executor", pool).counter().count());
                    } finally { release.countDown(); }
                }
            }
        } finally { registry.close(); }
    }

    @Test
    void publicJsonAndStreamCountCompletedAnswersOnceIncludingFallback() {
        var registry = new SimpleMeterRegistry();
        try {
            ThesisAssistantService service = mock(ThesisAssistantService.class);
            var controller = new ThesisAssistantController(service);
            ReflectionTestUtils.invokeMethod(controller, "bindMetrics", registry);
            var actor = Jwt.withTokenValue("fixture").header("alg", "none").subject("fixture-owner").build();
            controller.chat(new ThesisAssistantDtos.ChatRequest("hello", "en"), actor, new MockHttpServletRequest());
            controller.stream(new ThesisAssistantDtos.ChatRequest("hello", "en"), actor, new MockHttpServletRequest());
            assertEquals(2, registry.get("campuscore.assistant.requests").tag("degraded", "false").counter().count());
            var request = new ThesisAssistantDtos.ChatRequest("Quy chế học vụ", "vi");
            when(service.answer(anyString(), anyString(), any(), anyString(), any(), nullable(String.class)))
                    .thenThrow(new org.springframework.dao.DataAccessResourceFailureException("fixture"));
            controller.chat(request, actor, new MockHttpServletRequest());
            assertEquals(1, registry.get("campuscore.assistant.requests").tag("degraded", "true").counter().count());
        } finally { registry.close(); }
    }

    @Test
    void internalJsonAndStreamCountAtTheirBoundaryWithoutDoubleCountingDone() {
        var registry = new SimpleMeterRegistry();
        try {
            ThesisAssistantService service = mock(ThesisAssistantService.class);
            var response = new ThesisAssistantDtos.ChatResponse("answer", "fixture", true, "PROVIDER_TIMEOUT", "en", List.of());
            when(service.answer(anyString(), anyString(), any(), anyString(), any(), nullable(String.class))).thenReturn(response);
            doAnswer(call -> {
                Consumer<ThesisAssistantService.StreamEvent> sink = call.getArgument(5);
                var done = new ThesisAssistantService.StreamDone(UUID.randomUUID(), "ANSWERED", false, "COMPLETED");
                sink.accept(done);
                sink.accept(done);
                return null;
            }).when(service).stream(anyString(), anyString(), any(), anyString(), any(), any(), any());
            var controller = new ThesisAssistantInternalController(service,
                    new AssistantRagProperties("", "fixture-internal-key", true, 1000, 30000));
            ReflectionTestUtils.invokeMethod(controller, "bindMetrics", registry);
            var request = new ThesisAssistantDtos.ChatRequest("Quy chế học vụ", "vi");
            controller.chat(request, "fixture-internal-key", "fixture-owner");
            controller.stream(request, "fixture-internal-key", "fixture-owner");
            assertEquals(1, registry.get("campuscore.assistant.requests").tag("degraded", "true").counter().count());
            assertEquals(1, registry.get("campuscore.assistant.requests").tag("degraded", "false").counter().count());
        } finally { registry.close(); }
    }
}
