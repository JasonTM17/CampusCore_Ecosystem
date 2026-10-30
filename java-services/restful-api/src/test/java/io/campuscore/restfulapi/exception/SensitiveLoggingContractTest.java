package io.campuscore.restfulapi.exception;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.IThrowableProxy;
import ch.qos.logback.core.read.ListAppender;
import io.campuscore.restfulapi.security.RequestIdFilter;
import io.campuscore.restfulapi.thesis.assistant.AssistantCancellationRegistry;
import io.campuscore.restfulapi.thesis.assistant.ThesisAssistantRepository;
import io.campuscore.restfulapi.thesis.assistant.ThesisAssistantRetentionJob;
import io.campuscore.restfulapi.thesis.assistant.ThesisAssistantTurnRepository;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.http.ResponseEntity;

class SensitiveLoggingContractTest {

    private static final String REQUEST_ID = "aud14-request-001";
    private static final String OPAQUE_REQUEST_ID_SENTINEL = "mP7K2x9Q4v8B3c6T";
    private static final String BEARER_TOKEN_SENTINEL = "canary-bearer-token-1742";
    private static final String PASSWORD_SENTINEL = "canary-password-value-2381";
    private static final String PROMPT_SENTINEL = "canary-private-prompt-4610";
    private static final String SQL_BIND_SENTINEL = "canary-sql-bind-value-5938";
    private static final String PROVIDER_BODY_SENTINEL = "canary-provider-error-body-8073";
    private static final String AUTHORIZATION_SENTINEL = "canary-authorization-header-6395";
    private static final List<String> SENTINELS = List.of(
            BEARER_TOKEN_SENTINEL,
            PASSWORD_SENTINEL,
            PROMPT_SENTINEL,
            SQL_BIND_SENTINEL,
            PROVIDER_BODY_SENTINEL,
            AUTHORIZATION_SENTINEL);

    private final LoggerContext loggerContext = (LoggerContext) LoggerFactory.getILoggerFactory();
    private final Logger handlerLogger = (Logger) LoggerFactory.getLogger(GlobalExceptionHandler.class);
    private final Logger retentionLogger = (Logger) LoggerFactory.getLogger(ThesisAssistantRetentionJob.class);
    private final Logger redactorLogger = (Logger) LoggerFactory.getLogger(SensitiveLogRedactor.class);

    private SensitiveLogRedactor redactor;
    private ListAppender<ILoggingEvent> appender;
    private Level originalHandlerLevel;
    private Level originalRetentionLevel;
    private Level originalRedactorLevel;
    private boolean originalHandlerAdditivity;
    private boolean originalRetentionAdditivity;
    private boolean originalRedactorAdditivity;

    @BeforeEach
    void captureLogsWithoutConsolePropagation() {
        redactor = new SensitiveLogRedactor();
        redactor.register();

        originalHandlerLevel = handlerLogger.getLevel();
        originalRetentionLevel = retentionLogger.getLevel();
        originalRedactorLevel = redactorLogger.getLevel();
        originalHandlerAdditivity = handlerLogger.isAdditive();
        originalRetentionAdditivity = retentionLogger.isAdditive();
        originalRedactorAdditivity = redactorLogger.isAdditive();

        appender = new ListAppender<>();
        appender.setContext(loggerContext);
        appender.start();
        handlerLogger.addAppender(appender);
        retentionLogger.addAppender(appender);
        redactorLogger.addAppender(appender);
        handlerLogger.setLevel(Level.WARN);
        retentionLogger.setLevel(Level.WARN);
        redactorLogger.setLevel(Level.WARN);
        handlerLogger.setAdditive(false);
        retentionLogger.setAdditive(false);
        redactorLogger.setAdditive(false);
    }

    @AfterEach
    void restoreLoggerState() {
        handlerLogger.detachAppender(appender);
        retentionLogger.detachAppender(appender);
        redactorLogger.detachAppender(appender);
        appender.stop();
        handlerLogger.setLevel(originalHandlerLevel);
        retentionLogger.setLevel(originalRetentionLevel);
        redactorLogger.setLevel(originalRedactorLevel);
        handlerLogger.setAdditive(originalHandlerAdditivity);
        retentionLogger.setAdditive(originalRetentionAdditivity);
        redactorLogger.setAdditive(originalRedactorAdditivity);
        redactor.unregister();
    }

    @Test
    void exceptionDetailsNeverReachHandlerLogsOrHttpErrorBodies() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler();
        MockHttpServletRequest request = requestWithId();
        String providerFailure = String.join(" ",
                "Authorization:", AUTHORIZATION_SENTINEL,
                "Bearer", BEARER_TOKEN_SENTINEL,
                "password", PASSWORD_SENTINEL,
                "prompt", PROMPT_SENTINEL,
                "provider", PROVIDER_BODY_SENTINEL);

        ResponseEntity<ErrorResponse> persistenceResponse = handler.handleDataIntegrityViolation(
                new DataIntegrityViolationException("constraint value " + SQL_BIND_SENTINEL), request);
        ResponseEntity<ErrorResponse> providerResponse = handler.handleUnhandledException(
                new IllegalStateException(providerFailure), request);
        ResponseEntity<ErrorResponse> invalidRequestResponse = handler.handleIllegalArgument(
                new IllegalArgumentException(PASSWORD_SENTINEL), request);

        List<String> bodies = List.of(
                persistenceResponse.getBody().toString(),
                providerResponse.getBody().toString(),
                invalidRequestResponse.getBody().toString());
        for (String sentinel : SENTINELS) {
            assertFalse(bodies.stream().anyMatch(body -> body.contains(sentinel)),
                    "HTTP error body contained exception details");
            assertFalse(appender.list.stream().anyMatch(event -> eventContains(event, sentinel)),
                    "captured log event contained exception details");
        }

        assertTrue(appender.list.stream().anyMatch(event -> event.getFormattedMessage()
                        .contains("requestId=" + SensitiveLogRedactor.requestId(REQUEST_ID) + " code=CONFLICT")),
                "persistence log must retain request ID and stable error code");
        assertTrue(appender.list.stream().anyMatch(event -> event.getFormattedMessage()
                        .contains("requestId=" + SensitiveLogRedactor.requestId(REQUEST_ID) + " code=INTERNAL_ERROR")),
                "internal error log must retain request ID and stable error code");
    }

    @Test
    void opaqueCallerRequestIdIsPseudonymizedInLogsAndHttpErrorBody() {
        MockHttpServletRequest request = requestWithId(OPAQUE_REQUEST_ID_SENTINEL);
        ResponseEntity<ErrorResponse> response = new GlobalExceptionHandler().handleUnhandledException(
                new IllegalStateException(PROVIDER_BODY_SENTINEL),
                request);
        String body = response.getBody().toString();
        String correlatedRequestId = SensitiveLogRedactor.requestId(OPAQUE_REQUEST_ID_SENTINEL);

        assertFalse(body.contains(OPAQUE_REQUEST_ID_SENTINEL),
                "HTTP error body must not echo an opaque caller-supplied request ID");
        assertFalse(appender.list.stream().anyMatch(event ->
                        eventContains(event, OPAQUE_REQUEST_ID_SENTINEL)),
                "captured log event must not contain an opaque caller-supplied request ID");
        assertTrue(body.contains(correlatedRequestId),
                "HTTP error body must retain the privacy-preserving request correlation ID");
        assertTrue(appender.list.stream().anyMatch(event -> event.getFormattedMessage()
                        .contains("requestId=" + correlatedRequestId + " code=INTERNAL_ERROR")),
                "log event must retain the privacy-preserving request ID and stable error code");
    }

    @Test
    void assistantRetentionFailureDoesNotPublishExceptionDetails() {
        ThesisAssistantRepository repository = mock(ThesisAssistantRepository.class);
        ThesisAssistantTurnRepository turns = mock(ThesisAssistantTurnRepository.class);
        doThrow(new RuntimeException(PROMPT_SENTINEL)).when(turns).recoverExpiredLeases(any());
        doThrow(new RuntimeException(PROMPT_SENTINEL)).when(repository).purgeExpired();
        ThesisAssistantRetentionJob job = new ThesisAssistantRetentionJob(
                repository,
                turns,
                mock(AssistantCancellationRegistry.class));

        job.recoverExpiredLeases();
        job.purgeExpiredConversations();

        assertEquals(2, appender.list.stream().filter(event ->
                        SensitiveLogRedactor.class.getName().equals(event.getLoggerName())).count());
        assertTrue(appender.list.stream().noneMatch(event -> eventContains(event, PROMPT_SENTINEL)),
                "retention failure must not publish exception details");
        assertTrue(appender.list.stream().noneMatch(event ->
                        ThesisAssistantRetentionJob.class.getName().equals(event.getLoggerName())),
                "retention failure event must be suppressed while its source remains separately owned");
        assertTrue(appender.list.stream().anyMatch(event -> event.getFormattedMessage()
                        .contains("code=ASSISTANT_RETENTION_FAILURE exceptionType=RuntimeException")),
                "retention failure must retain a safe operational signal");
    }

    private static MockHttpServletRequest requestWithId() {
        return requestWithId(REQUEST_ID);
    }

    private static MockHttpServletRequest requestWithId(String requestId) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/sensitive");
        request.setAttribute(RequestIdFilter.ATTRIBUTE, requestId);
        return request;
    }

    private static boolean eventContains(ILoggingEvent event, String sentinel) {
        if (event.getFormattedMessage().contains(sentinel)) {
            return true;
        }
        IThrowableProxy throwable = event.getThrowableProxy();
        while (throwable != null) {
            if (throwable.getMessage() != null && throwable.getMessage().contains(sentinel)) {
                return true;
            }
            throwable = throwable.getCause();
        }
        return false;
    }
}
