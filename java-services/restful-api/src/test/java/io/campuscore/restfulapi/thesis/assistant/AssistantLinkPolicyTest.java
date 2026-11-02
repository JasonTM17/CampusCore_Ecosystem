package io.campuscore.restfulapi.thesis.assistant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import io.campuscore.restfulapi.thesis.assistant.ThesisAssistantDtos.ChatResponse;
import io.campuscore.restfulapi.thesis.assistant.ThesisAssistantRepository.Message;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

class AssistantLinkPolicyTest {

    private static final String FIXTURE = "assistant-link-policy-cases.json";

    @Test
    void sharedConformanceCasesMatchTheJavaPolicy() throws Exception {
        JsonNode fixture = readFixture();
        Set<String> routes = new java.util.LinkedHashSet<>();
        fixture.path("dashboardRoutes").forEach(value -> routes.add(value.asText()));
        assertEquals(routes, AssistantLinkPolicy.allowedDashboardRoutes());

        for (JsonNode item : fixture.path("cases")) {
            String destination = item.path("destination").asText();
            boolean allowed = item.path("allowed").asBoolean();
            String actual = AssistantLinkPolicy.allowedDestination(destination);
            if (allowed) assertEquals(destination, actual, item.path("name").asText());
            else assertNull(actual, item.path("name").asText());
        }
    }

    @Test
    void deniedLinksBecomePlainLabelsWithoutLosingSurroundingAnswerText() {
        String raw = "Before [document](/docs/academic-regulations) and [outside](https://example.edu/x), after.";
        String sanitized = AssistantLinkSanitizer.sanitizeMarkdownLinks(raw);
        assertEquals("Before [document](/docs/academic-regulations) and outside, after.", sanitized);
    }

    @Test
    void everyDeltaSplitBoundarySanitizesDeniedLinksAfterReassembly() {
        String raw = "Before [document](/docs/academic-regulations?rev=2) and [outside](https://xn--e1afmkfd.example/policy), after.";
        String expected = AssistantLinkSanitizer.sanitizeMarkdownLinks(raw);
        for (int split = 0; split <= raw.length(); split++) {
            List<ThesisAssistantService.StreamEvent> events = new ArrayList<>();
            var sink = AssistantLinkSanitizer.sanitizingSink(events::add);
            sink.accept(new ThesisAssistantService.StreamDelta(0, raw.substring(0, split), List.of("doc")));
            sink.accept(new ThesisAssistantService.StreamDelta(1, raw.substring(split), List.of("doc")));
            sink.accept(new ThesisAssistantService.StreamDone(UUID.randomUUID(), "ANSWERED", false, "COMPLETED"));
            String actual = events.stream()
                    .filter(ThesisAssistantService.StreamDelta.class::isInstance)
                    .map(ThesisAssistantService.StreamDelta.class::cast)
                    .map(ThesisAssistantService.StreamDelta::text)
                    .reduce("", String::concat);
            assertEquals(expected, actual, "split=" + split);
        }

        List<ThesisAssistantService.StreamEvent> characterEvents = new ArrayList<>();
        var characterSink = AssistantLinkSanitizer.sanitizingSink(characterEvents::add);
        for (int index = 0; index < raw.length(); index++) {
            characterSink.accept(new ThesisAssistantService.StreamDelta(index, raw.substring(index, index + 1), List.of("doc")));
        }
        characterSink.accept(new ThesisAssistantService.StreamDone(UUID.randomUUID(), "ANSWERED", false, "COMPLETED"));
        String characterActual = characterEvents.stream()
                .filter(ThesisAssistantService.StreamDelta.class::isInstance)
                .map(ThesisAssistantService.StreamDelta.class::cast)
                .map(ThesisAssistantService.StreamDelta::text)
                .reduce("", String::concat);
        assertEquals(expected, characterActual);
    }

    @Test
    void chatResponsesAndHistoricalMessagesAreSanitizedButUserMessagesArePreserved() {
        String raw = "Read [this](javascript:document.cookie) and keep this sentence.";
        ChatResponse response = new ChatResponse(raw, "model", false, "ANSWERED", "en", List.of());
        assertEquals("Read this and keep this sentence.", AssistantLinkSanitizer.sanitize(response).answer());

        Message assistant = new Message(UUID.randomUUID(), "ASSISTANT", raw, "model", false,
                "ANSWERED", Instant.now(), List.of(), null);
        Message user = new Message(UUID.randomUUID(), "USER", raw, null, false,
                "RECEIVED", Instant.now(), List.of(), null);
        assertEquals("Read this and keep this sentence.", AssistantLinkSanitizer.sanitize(assistant).content());
        assertEquals(raw, AssistantLinkSanitizer.sanitize(user).content());
        assertNotNull(AssistantLinkSanitizer.sanitize(assistant).id());
    }

    private static JsonNode readFixture() throws Exception {
        List<Path> candidates = List.of(
                Path.of("contracts", FIXTURE),
                Path.of("..", "..", "contracts", FIXTURE));
        for (Path candidate : candidates) {
            if (Files.isRegularFile(candidate)) {
                return new ObjectMapper().readTree(Files.readString(candidate));
            }
        }
        throw new IllegalStateException("Could not find shared conformance fixture at " + candidates);
    }
}
