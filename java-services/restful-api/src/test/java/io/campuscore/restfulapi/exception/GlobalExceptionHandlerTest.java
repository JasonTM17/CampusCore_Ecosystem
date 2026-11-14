package io.campuscore.restfulapi.exception;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.campuscore.restfulapi.security.RequestIdFilter;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.validation.BeanPropertyBindingResult;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpMediaTypeNotAcceptableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    private static MockHttpServletRequest request() {
        return new MockHttpServletRequest("GET", "/api/v1/test");
    }

    @Test
    void appExceptionCarriesStatusCodeAndMessage() {
        ResponseEntity<ErrorResponse> response = handler.handleAppException(
                new AppException(ErrorCode.COURSE_NOT_FOUND), request());

        assertEquals(HttpStatus.NOT_FOUND, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("COURSE_NOT_FOUND", response.getBody().code());
        assertEquals(ErrorCode.COURSE_NOT_FOUND.getDefaultMessage(), response.getBody().message());
        assertEquals("/api/v1/test", response.getBody().path());
    }

    @Test
    void validationExceptionSurfacesFieldErrors() {
        ResponseEntity<ErrorResponse> response = handler.handleAppException(
                new ValidationException("bad fields", Map.of("email", "must be valid")), request());

        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals(Map.of("email", "must be valid"), response.getBody().fields());
        assertEquals(List.of(new ErrorResponse.FieldErrorItem("email", "must be valid")),
                response.getBody().fieldErrors());
    }

    @Test
    void authenticationExceptionAnswers401() {
        ResponseEntity<ErrorResponse> response = handler.handleAuthenticationException(
                new BadCredentialsException("bad"), request());

        assertEquals(HttpStatus.UNAUTHORIZED, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("UNAUTHENTICATED", response.getBody().code());
    }

    @Test
    void accessDeniedAnswers403() {
        ResponseEntity<ErrorResponse> response = handler.handleAccessDeniedException(
                new AccessDeniedException("denied"), request());

        assertEquals(HttpStatus.FORBIDDEN, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("ACCESS_DENIED", response.getBody().code());
    }

    @Test
    void responseStatusException404UsesSemanticNotFoundCode() {
        ResponseEntity<ErrorResponse> response = handler.handleResponseStatusException(
                new ResponseStatusException(HttpStatus.NOT_FOUND, "missing thing"), request());

        assertEquals(HttpStatus.NOT_FOUND, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("NOT_FOUND", response.getBody().code());
        assertEquals("missing thing", response.getBody().message());
    }

    @Test
    void responseStatusExceptionKeepsHttpCodeForOtherStatuses() {
        ResponseEntity<ErrorResponse> response = handler.handleResponseStatusException(
                new ResponseStatusException(HttpStatus.CONFLICT), request());

        assertEquals(HttpStatus.CONFLICT, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("HTTP_409", response.getBody().code());
        assertEquals(HttpStatus.CONFLICT.getReasonPhrase(), response.getBody().message());
    }

    @Test
    void beanValidationCollectsFieldErrors() throws Exception {
        BeanPropertyBindingResult bindingResult =
                new BeanPropertyBindingResult(new Object(), "request");
        bindingResult.addError(new FieldError("request", "name", "must not be blank"));
        MethodArgumentNotValidException exception =
                new MethodArgumentNotValidException(null, bindingResult);

        ResponseEntity<ErrorResponse> response =
                handler.handleMethodArgumentNotValidException(exception, request());

        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("VALIDATION_ERROR", response.getBody().code());
        assertEquals(Map.of("name", "must not be blank"), response.getBody().fields());
    }

    @Test
    void unreadableBodyAnswers400() {
        ResponseEntity<ErrorResponse> response = handler.handleMalformedRequest(
                new HttpMessageNotReadableException("bad json", (org.springframework.http.HttpInputMessage) null), request());

        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("INVALID_REQUEST", response.getBody().code());
    }

    @Test
    void missingStaticResourceAnswers404() {
        ResponseEntity<ErrorResponse> response = handler.handleNoResourceFound(
                new NoResourceFoundException(org.springframework.http.HttpMethod.GET, "/api/v1/none", "/api/v1/none"), request());

        assertEquals(HttpStatus.NOT_FOUND, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("NOT_FOUND", response.getBody().code());
    }

    @Test
    void wrongMethodAnswers405() {
        ResponseEntity<ErrorResponse> response = handler.handleMethodNotSupported(
                new HttpRequestMethodNotSupportedException("DELETE"), request());

        assertEquals(HttpStatus.METHOD_NOT_ALLOWED, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("METHOD_NOT_ALLOWED", response.getBody().code());
    }

    @Test
    void wrongContentTypeAnswers415() {
        ResponseEntity<ErrorResponse> response = handler.handleMediaTypeNotSupported(
                new HttpMediaTypeNotSupportedException("text/plain"), request());

        assertEquals(HttpStatus.UNSUPPORTED_MEDIA_TYPE, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("UNSUPPORTED_MEDIA_TYPE", response.getBody().code());
    }

    @Test
    void unacceptableAcceptAnswers406() {
        ResponseEntity<ErrorResponse> response = handler.handleMediaTypeNotAcceptable(
                new HttpMediaTypeNotAcceptableException("no match"), request());

        assertEquals(HttpStatus.NOT_ACCEPTABLE, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("NOT_ACCEPTABLE", response.getBody().code());
    }

    @Test
    void illegalArgumentAnswers400() {
        ResponseEntity<ErrorResponse> response = handler.handleIllegalArgument(
                new IllegalArgumentException("nope"), request());

        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("INVALID_REQUEST", response.getBody().code());
    }

    @Test
    void dataIntegrityViolationAnswers409() {
        ResponseEntity<ErrorResponse> response = handler.handleDataIntegrityViolation(
                new DataIntegrityViolationException("duplicate key"), request());

        assertEquals(HttpStatus.CONFLICT, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("CONFLICT", response.getBody().code());
    }

    @Test
    void oversizeUploadAnswers413() {
        ResponseEntity<ErrorResponse> response = handler.handleMaxUploadSize(
                new MaxUploadSizeExceededException(20L * 1024 * 1024), request());

        assertEquals(HttpStatus.PAYLOAD_TOO_LARGE, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("FILE_TOO_LARGE", response.getBody().code());
    }

    @Test
    void unhandledExceptionAnswers500() {
        ResponseEntity<ErrorResponse> response = handler.handleUnhandledException(
                new RuntimeException("boom"), request());

        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("INTERNAL_ERROR", response.getBody().code());
    }

    @Test
    void requestIdAttributePropagatesIntoEnvelope() {
        MockHttpServletRequest request = request();
        request.setAttribute(RequestIdFilter.ATTRIBUTE, "req-abc-123");

        ResponseEntity<ErrorResponse> response = handler.handleUnhandledException(
                new RuntimeException("boom"), request);

        assertNotNull(response.getBody());
        assertEquals(SensitiveLogRedactor.requestId("req-abc-123"), response.getBody().requestId());
    }

    @Test
    void missingRequestIdStaysNull() {
        ResponseEntity<ErrorResponse> response = handler.handleUnhandledException(
                new RuntimeException("boom"), request());

        assertNotNull(response.getBody());
        assertNull(response.getBody().requestId());
        assertTrue(response.getBody().fields().isEmpty());
    }
}
