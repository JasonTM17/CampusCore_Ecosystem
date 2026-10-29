package io.campuscore.restfulapi.attendance;

import io.campuscore.restfulapi.exception.ErrorResponse;
import io.campuscore.restfulapi.security.RequestIdFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import java.time.Instant;
import java.util.Map;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;

/** Path/method validation must not fall through to the generic internal-error handler. */
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes={AttendanceSessionController.class,AttendanceCheckinController.class,AttendanceGeofenceController.class})
public class AttendanceValidationHandler {
    @ExceptionHandler({ConstraintViolationException.class,HandlerMethodValidationException.class})
    public ResponseEntity<ErrorResponse> invalidPath(HttpServletRequest request) {
        Object id=request.getAttribute(RequestIdFilter.ATTRIBUTE);
        return ResponseEntity.badRequest().body(new ErrorResponse(Instant.now(),400,"VALIDATION_FAILED",
                "Invalid attendance request",request.getRequestURI(),id==null?null:id.toString(),Map.of()));
    }
}
