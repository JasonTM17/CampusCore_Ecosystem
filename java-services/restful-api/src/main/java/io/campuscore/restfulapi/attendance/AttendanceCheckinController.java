package io.campuscore.restfulapi.attendance;

import static io.campuscore.restfulapi.attendance.AttendanceDtos.*;
import io.campuscore.restfulapi.exception.ErrorResponse;
import io.campuscore.restfulapi.security.RequestIdFilter;
import io.campuscore.restfulapi.security.ratelimit.ClientIpResolver;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.Map;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;

@Tag(name="Attendance Check-in")
@RestController
@Validated
@Profile("persistence")
@RequestMapping("/api/v1/attendance")
public class AttendanceCheckinController {
    private final CheckinService service;
    private final ClientIpResolver ips;
    public AttendanceCheckinController(CheckinService service,ClientIpResolver ips) { this.service=service;this.ips=ips; }
    @PostMapping("/sessions/{id}/checkin")
    @PreAuthorize("hasRole('STUDENT')")
    @Operation(operationId="attendanceStudentCheckin",summary="Sinh viên xác nhận điểm danh tại khu vực cho phép")
    @ApiResponses({@ApiResponse(responseCode="200",description="ACCEPTED hoặc PENDING_REVIEW",
                content=@Content(schema=@Schema(implementation=CheckinResponse.class))),
        @ApiResponse(responseCode="400",description="INVALID_LOCATION",
                content=@Content(schema=@Schema(implementation=ErrorResponse.class))),
        @ApiResponse(responseCode="403",description="NOT_ENROLLED hoặc CONSENT_REQUIRED",
                content=@Content(schema=@Schema(implementation=ErrorResponse.class))),
        @ApiResponse(responseCode="409",description="ALREADY_CHECKED_IN",
                content=@Content(schema=@Schema(implementation=ErrorResponse.class))),
        @ApiResponse(responseCode="410",description="SESSION_CLOSED",
                content=@Content(schema=@Schema(implementation=ErrorResponse.class))),
        @ApiResponse(responseCode="422",description="BAD_CODE, OUTSIDE_AREA hoặc LOW_ACCURACY",
                content=@Content(schema=@Schema(implementation=ErrorResponse.class))),
        @ApiResponse(responseCode="429",description="TOO_MANY_ATTEMPTS; Retry-After",
                content=@Content(schema=@Schema(implementation=ErrorResponse.class)))})
    public CheckinResponse checkin(@AuthenticationPrincipal Jwt jwt,@PathVariable @Size(max=120) String id,
            @Valid @RequestBody CheckinRequest r,HttpServletRequest request) {
        return service.checkin(id,AttendanceSessionController.student(jwt),r,ips.resolve(request));
    }
    @PostMapping("/location-consent")
    @PreAuthorize("hasRole('STUDENT')")
    @Operation(operationId="attendanceAcceptLocationConsent",summary="Ghi nhận đồng ý sử dụng vị trí khi điểm danh")
    public ConsentResponse consent(@AuthenticationPrincipal Jwt jwt,@Valid @RequestBody ConsentRequest r) {
        return service.acceptConsent(AttendanceSessionController.student(jwt),r.version());
    }
    @GetMapping("/location-consent")
    @PreAuthorize("hasRole('STUDENT')")
    @Operation(operationId="attendanceGetLocationConsent",summary="Xem phiên bản đồng ý sử dụng vị trí")
    public ConsentResponse consent(@AuthenticationPrincipal Jwt jwt) { return service.consent(AttendanceSessionController.student(jwt)); }

    @ExceptionHandler(CheckinService.Throttled.class)
    public ResponseEntity<ErrorResponse> throttled(CheckinService.Throttled e,HttpServletRequest request) {
        return ResponseEntity.status(429).header("Retry-After",Long.toString(e.retryAfter())).body(error(429,e.code(),request));
    }
    @ExceptionHandler({MethodArgumentNotValidException.class,HttpMessageNotReadableException.class})
    public ResponseEntity<ErrorResponse> invalid(Exception e,HttpServletRequest request) {
        boolean checkin=request.getRequestURI().endsWith("/checkin");
        String code=checkin?"INVALID_LOCATION":"VALIDATION_FAILED";
        int status=400;
        if(checkin && e instanceof MethodArgumentNotValidException invalid
                && invalid.getBindingResult().getFieldErrors().stream().allMatch(f->f.getField().equals("code"))) {
            code="BAD_CODE"; status=422;
        }
        if(checkin && SecurityContextHolder.getContext().getAuthentication().getPrincipal() instanceof Jwt jwt) {
            String[] path=request.getRequestURI().split("/");
            String id=path[path.length-2];
            try { service.recordInvalidAttempt(id,AttendanceSessionController.student(jwt),ips.resolve(request),code); }
            catch(CheckinService.Throttled limited) { return throttled(limited,request); }
        }
        return ResponseEntity.status(status).body(error(status,code,request));
    }
    private static ErrorResponse error(int status,String code,HttpServletRequest r) {
        Object requestId=r.getAttribute(RequestIdFilter.ATTRIBUTE);
        return new ErrorResponse(Instant.now(),status,code,code.replace('_',' '),r.getRequestURI(),requestId==null?null:requestId.toString(),Map.of());
    }
}
