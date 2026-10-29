package io.campuscore.restfulapi.exception;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.turbo.TurboFilter;
import ch.qos.logback.core.spi.FilterReply;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.LoggerFactory;
import org.slf4j.Marker;
import org.springframework.stereotype.Component;

/** Central policy for keeping exception-controlled values out of production logs. */
@Component
public final class SensitiveLogRedactor extends TurboFilter {

    private static final String ASSISTANT_RETENTION_LOGGER =
            "io.campuscore.restfulapi.thesis.assistant.ThesisAssistantRetentionJob";
    private static final SecretKeySpec REQUEST_ID_HMAC_KEY = requestIdHmacKey();
    private static final org.slf4j.Logger SAFE_LOGGER = LoggerFactory.getLogger(SensitiveLogRedactor.class);

    private LoggerContext loggerContext;

    /** Return only the code-defined exception type; never include its message or stack. */
    public static String exceptionType(Throwable failure) {
        if (failure == null) {
            return "UnknownException";
        }
        String simpleName = failure.getClass().getSimpleName();
        return simpleName.isBlank() ? "Exception" : simpleName;
    }

    /** Return a process-stable pseudonym so caller-controlled IDs never enter logs or error bodies verbatim. */
    public static String requestId(Object value) {
        if (!(value instanceof String requestId) || requestId.isBlank() || requestId.length() > 128) {
            return "unavailable";
        }
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(REQUEST_ID_HMAC_KEY);
            return "hmac-" + HexFormat.of().formatHex(mac.doFinal(requestId.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException exception) {
            return "unavailable";
        }
    }

    private static SecretKeySpec requestIdHmacKey() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        return new SecretKeySpec(key, "HmacSHA256");
    }

    @PostConstruct
    public void register() {
        loggerContext = (LoggerContext) LoggerFactory.getILoggerFactory();
        setContext(loggerContext);
        start();
        loggerContext.addTurboFilter(this);
    }

    @PreDestroy
    public void unregister() {
        if (loggerContext != null) {
            loggerContext.getTurboFilterList().remove(this);
        }
        stop();
    }

    @Override
    public FilterReply decide(
            Marker marker,
            Logger logger,
            Level level,
            String format,
            Object[] params,
            Throwable throwable) {
        // The retention job is owned by another workstream and currently logs
        // both exception text and the throwable. Suppress only those failure
        // events until that callsite can be changed without crossing ownership.
        Throwable failure = findThrowable(params, throwable);
        if (logger != null && ASSISTANT_RETENTION_LOGGER.equals(logger.getName()) && failure != null) {
            SAFE_LOGGER.warn("code=ASSISTANT_RETENTION_FAILURE exceptionType={}", exceptionType(failure));
            return FilterReply.DENY;
        }
        return FilterReply.NEUTRAL;
    }

    private static Throwable findThrowable(Object[] params, Throwable throwable) {
        if (throwable != null) {
            return throwable;
        }
        if (params == null) {
            return null;
        }
        for (Object parameter : params) {
            if (parameter instanceof Throwable) {
                return (Throwable) parameter;
            }
        }
        return null;
    }
}
