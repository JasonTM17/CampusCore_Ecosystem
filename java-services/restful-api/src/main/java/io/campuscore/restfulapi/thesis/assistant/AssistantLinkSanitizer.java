package io.campuscore.restfulapi.thesis.assistant;

import io.campuscore.restfulapi.thesis.assistant.ThesisAssistantDtos.ChatResponse;
import io.campuscore.restfulapi.thesis.assistant.ThesisAssistantRepository.Conversation;
import io.campuscore.restfulapi.thesis.assistant.ThesisAssistantRepository.Message;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.function.Consumer;

/** Strips denied assistant link destinations without dropping answer text. */
public final class AssistantLinkSanitizer {

    private AssistantLinkSanitizer() { }

    public static String sanitizeMarkdownLinks(String markdown) {
        if (markdown == null || markdown.isEmpty()) return markdown;
        return new LinkStream().accept(markdown, true);
    }

    public static ChatResponse sanitize(ChatResponse response) {
        if (response == null) return null;
        String answer = sanitizeMarkdownLinks(response.answer());
        if (java.util.Objects.equals(answer, response.answer())) return response;
        return new ChatResponse(answer, response.model(), response.degraded(), response.reasonCode(),
                response.locale(), response.citations(), response.requestId(), response.clientRequestId(),
                response.turnId(), response.replayed(), response.terminalStatus(), response.conversationId(),
                response.messageId(), response.resetAt());
    }

    public static Message sanitize(Message message) {
        if (message == null || message.role() == null || !"ASSISTANT".equalsIgnoreCase(message.role())) {
            return message;
        }
        String content = sanitizeMarkdownLinks(message.content());
        if (java.util.Objects.equals(content, message.content())) return message;
        return new Message(message.id(), message.role(), content, message.model(), message.degraded(),
                message.reasonCode(), message.createdAt(), message.citations(), message.feedback());
    }

    public static Conversation sanitize(Conversation conversation) {
        if (conversation == null) return null;
        String title = sanitizeMarkdownLinks(conversation.title());
        if (java.util.Objects.equals(title, conversation.title())) return conversation;
        return new Conversation(conversation.id(), title, conversation.locale(), conversation.createdAt(),
                conversation.updatedAt(), conversation.ownerId(), conversation.scope());
    }

    /**
     * Stateful SSE boundary: a Markdown link split across deltas is held until
     * its destination is known, then either forwarded intact or reduced to its
     * visible label. The final flush preserves any incomplete ordinary text.
     */
    public static Consumer<ThesisAssistantService.StreamEvent> sanitizingSink(
            Consumer<ThesisAssistantService.StreamEvent> downstream) {
        if (downstream == null) return ignored -> { };
        LinkStream parser = new LinkStream();
        Set<String> pendingSourceIds = new LinkedHashSet<>();
        int[] highestSequence = { -1 };
        int[] lastInputSequence = { -1 };
        return event -> {
            if (event instanceof ThesisAssistantService.StreamDelta delta) {
                if (delta.sourceIds() != null) {
                    delta.sourceIds().stream().filter(value -> value != null && !value.isBlank())
                            .forEach(pendingSourceIds::add);
                }
                lastInputSequence[0] = delta.sequence();
                String safe = parser.accept(delta.text(), false);
                if (!safe.isEmpty()) {
                    downstream.accept(new ThesisAssistantService.StreamDelta(delta.sequence(), safe,
                            List.copyOf(pendingSourceIds)));
                    pendingSourceIds.clear();
                    highestSequence[0] = Math.max(highestSequence[0], delta.sequence());
                }
                return;
            }
            if (event instanceof ThesisAssistantService.StreamReplace replace) {
                parser.reset();
                pendingSourceIds.clear();
                if (replace.sourceIds() != null) {
                    replace.sourceIds().stream().filter(value -> value != null && !value.isBlank())
                            .forEach(pendingSourceIds::add);
                }
                downstream.accept(new ThesisAssistantService.StreamReplace(
                        sanitizeMarkdownLinks(replace.text()), List.copyOf(pendingSourceIds), replace.reasonCode()));
                pendingSourceIds.clear();
                return;
            }
            if (event instanceof ThesisAssistantService.StreamDone || event instanceof ThesisAssistantService.StreamError) {
                String tail = parser.accept("", true);
                if (!tail.isEmpty()) {
                    int sequence = Math.max(highestSequence[0] + 1, lastInputSequence[0]);
                    downstream.accept(new ThesisAssistantService.StreamDelta(sequence, tail,
                            List.copyOf(pendingSourceIds)));
                    pendingSourceIds.clear();
                    highestSequence[0] = sequence;
                }
                downstream.accept(event);
                return;
            }
            downstream.accept(event);
        };
    }

    private static final class LinkStream {
        private final StringBuilder pending = new StringBuilder();

        private String accept(String chunk, boolean terminal) {
            if (chunk != null) pending.append(chunk);
            StringBuilder output = new StringBuilder();
            int lineBreak;
            while ((lineBreak = nextLineBreak()) >= 0) {
                output.append(processPrefix(lineBreak, true));
                int breakLength = pending.charAt(0) == '\r'
                        && pending.length() > 1 && pending.charAt(1) == '\n' ? 2 : 1;
                output.append(pending, 0, breakLength);
                pending.delete(0, breakLength);
            }
            output.append(processPrefix(pending.length(), terminal));
            return output.toString();
        }

        private String processPrefix(int limit, boolean terminal) {
            StringBuilder output = new StringBuilder();
            int cursor = 0;
            while (cursor < limit) {
                int open = indexOf('[', cursor, limit);
                if (open < 0) {
                    int end = limit;
                    if (!terminal && end > cursor && pending.charAt(end - 1) == '!') end--;
                    output.append(pending, cursor, end);
                    cursor = end;
                    break;
                }
                int start = open > cursor && pending.charAt(open - 1) == '!' ? open - 1 : open;
                output.append(pending, cursor, start);
                int close = indexOf(']', open + 1, limit);
                if (close < 0) {
                    if (terminal) {
                        output.append(pending, start, limit);
                        cursor = limit;
                    } else {
                        cursor = start;
                    }
                    break;
                }
                if (close + 1 >= limit) {
                    if (terminal) {
                        output.append(pending, start, limit);
                        cursor = limit;
                    } else {
                        cursor = start;
                    }
                    break;
                }
                if (pending.charAt(close + 1) != '(') {
                    output.append(pending, start, close + 1);
                    cursor = close + 1;
                    continue;
                }
                int end = closingParen(close + 2, limit);
                if (end < 0 || end >= limit) {
                    if (terminal) {
                        output.append(pending, start, limit);
                        cursor = limit;
                    } else {
                        cursor = start;
                    }
                    break;
                }
                String destination = pending.substring(close + 2, end);
                if (AssistantLinkPolicy.allowedDestination(destination) != null) {
                    output.append(pending, start, end + 1);
                } else {
                    output.append(pending, open + 1, close);
                }
                cursor = end + 1;
            }
            if (cursor > 0) pending.delete(0, cursor);
            return output.toString();
        }

        private void reset() {
            pending.setLength(0);
        }

        private int closingParen(int from, int limit) {
            int depth = 1;
            for (int index = from; index < Math.min(limit, pending.length()); index++) {
                char value = pending.charAt(index);
                if (value == '\\') { index++; continue; }
                if (value == '(') depth++;
                if (value == ')') {
                    depth--;
                    if (depth == 0) return index;
                }
            }
            return -1;
        }

        private int indexOf(char value, int from, int limit) {
            for (int index = Math.max(0, from); index < Math.min(limit, pending.length()); index++) {
                if (pending.charAt(index) == value) return index;
            }
            return -1;
        }

        private int nextLineBreak() {
            for (int index = 0; index < pending.length(); index++) {
                if (pending.charAt(index) == '\n' || pending.charAt(index) == '\r') return index;
            }
            return -1;
        }
    }
}
