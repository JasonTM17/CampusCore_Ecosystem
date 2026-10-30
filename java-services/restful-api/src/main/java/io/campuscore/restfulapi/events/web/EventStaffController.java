package io.campuscore.restfulapi.events.web;

import io.campuscore.restfulapi.events.service.EventService;
import io.campuscore.restfulapi.events.web.EventDtos.AttendanceBatchRequest;
import io.campuscore.restfulapi.events.web.EventDtos.CancelEventRequest;
import io.campuscore.restfulapi.events.web.EventDtos.CreateEventRequest;
import io.campuscore.restfulapi.events.web.EventDtos.EventResponse;
import io.campuscore.restfulapi.events.web.EventDtos.OpenRegistrationRequest;
import io.campuscore.restfulapi.events.web.EventDtos.RosterEntry;
import io.campuscore.restfulapi.events.web.EventDtos.StaffGrantResponse;
import io.campuscore.restfulapi.events.web.EventDtos.UpdateEventRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Staff event surface. Coarse gate is authentication; the scoped
 * {@code STAFF:events} grant is enforced inside the service so an
 * authenticated non-grantee receives 403 EVENTS_STAFF_REQUIRED (contract
 * §1.1 — roles never imply domain rights). Grant administration additionally
 * requires the ADMIN role.
 */
@Tag(name = "Events Staff", description = "Quản trị sự kiện Đoàn–Hội: vòng đời, roster, điểm danh thủ công, staff grants")
@RestController
@Profile("persistence")
@RequestMapping("/api/v1/events/staff")
public class EventStaffController {

    private final EventService events;

    public EventStaffController(EventService events) {
        this.events = events;
    }

    @Operation(summary = "Danh sách sự kiện (staff, gồm draft)")
    @ApiResponse(responseCode = "200", description = "Danh sách sự kiện", headers = @Header(
            name = ListPaging.TOTAL_COUNT_HEADER, description = ListPaging.TOTAL_COUNT_DOC,
            schema = @Schema(type = "integer")))
    @GetMapping
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<List<EventResponse>> list(
            @AuthenticationPrincipal Jwt jwt,
            HttpServletRequest request,
            @Parameter(description = ListPaging.PAGE_DOC) @RequestParam(required = false) Integer page,
            @Parameter(description = ListPaging.LIMIT_DOC) @RequestParam(required = false) Integer limit) {
        ListPaging.Window window = ListPaging.Window.of(page, limit, request);
        return ListPaging.respond(events.listStaffEvents(subject(jwt), window));
    }

    @Operation(summary = "Tạo sự kiện nháp")
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("isAuthenticated()")
    public EventResponse create(
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody CreateEventRequest request) {
        return events.create(subject(jwt), request);
    }

    @Operation(summary = "Chi tiết sự kiện (staff)")
    @GetMapping("{eventId}")
    @PreAuthorize("isAuthenticated()")
    public EventResponse detail(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String eventId) {
        return events.staffEvent(subject(jwt), eventId);
    }

    @Operation(summary = "Sửa sự kiện nháp")
    @PutMapping("{eventId}")
    @PreAuthorize("isAuthenticated()")
    public EventResponse update(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String eventId,
            @RequestBody UpdateEventRequest request) {
        return events.update(subject(jwt), eventId, request);
    }

    @Operation(summary = "Công bố sự kiện (chủ sở hữu)")
    @PostMapping("{eventId}/publish")
    @PreAuthorize("isAuthenticated()")
    public EventResponse publish(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String eventId) {
        return events.publish(subject(jwt), eventId);
    }

    @Operation(summary = "Mở đăng ký trong cửa sổ")
    @PostMapping("{eventId}/open-registration")
    @PreAuthorize("isAuthenticated()")
    public EventResponse openRegistration(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String eventId,
            @RequestBody(required = false) OpenRegistrationRequest request) {
        return events.openRegistration(subject(jwt), eventId, request);
    }

    @Operation(summary = "Đóng đăng ký")
    @PostMapping("{eventId}/close-registration")
    @PreAuthorize("isAuthenticated()")
    public EventResponse closeRegistration(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String eventId) {
        return events.closeRegistration(subject(jwt), eventId);
    }

    @Operation(summary = "Hủy sự kiện (kèm thông báo cùng giao dịch)")
    @PostMapping("{eventId}/cancel")
    @PreAuthorize("isAuthenticated()")
    public EventResponse cancel(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String eventId,
            @RequestBody(required = false) CancelEventRequest request) {
        return events.cancel(subject(jwt), eventId, request == null ? null : request.reason());
    }

    @Operation(summary = "Hoàn tất sự kiện")
    @PostMapping("{eventId}/complete")
    @PreAuthorize("isAuthenticated()")
    public EventResponse complete(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String eventId) {
        return events.complete(subject(jwt), eventId);
    }

    @Operation(summary = "Roster đăng ký (staff only)")
    @ApiResponse(responseCode = "200", description = "Roster đăng ký", headers = @Header(
            name = ListPaging.TOTAL_COUNT_HEADER, description = ListPaging.TOTAL_COUNT_DOC,
            schema = @Schema(type = "integer")))
    @GetMapping("{eventId}/roster")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<List<RosterEntry>> roster(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String eventId,
            HttpServletRequest request,
            @Parameter(description = ListPaging.PAGE_DOC) @RequestParam(required = false) Integer page,
            @Parameter(description = ListPaging.LIMIT_DOC) @RequestParam(required = false) Integer limit) {
        ListPaging.Window window = ListPaging.Window.of(page, limit, request);
        return ListPaging.respond(events.roster(subject(jwt), eventId, window));
    }

    @Operation(summary = "Điểm danh thủ công theo roster")
    @PostMapping("{eventId}/attendance")
    @PreAuthorize("isAuthenticated()")
    public List<RosterEntry> markAttendance(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String eventId,
            @RequestBody AttendanceBatchRequest request) {
        return events.markAttendance(subject(jwt), eventId, request);
    }

    @Operation(summary = "Danh sách staff grants")
    @ApiResponse(responseCode = "200", description = "Danh sách staff grants", headers = @Header(
            name = ListPaging.TOTAL_COUNT_HEADER, description = ListPaging.TOTAL_COUNT_DOC,
            schema = @Schema(type = "integer")))
    @GetMapping("grants")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<List<StaffGrantResponse>> grants(
            @AuthenticationPrincipal Jwt jwt,
            HttpServletRequest request,
            @Parameter(description = ListPaging.PAGE_DOC) @RequestParam(required = false) Integer page,
            @Parameter(description = ListPaging.LIMIT_DOC) @RequestParam(required = false) Integer limit) {
        ListPaging.Window window = ListPaging.Window.of(page, limit, request);
        return ListPaging.respond(events.listGrants(subject(jwt), window));
    }

    @Operation(summary = "Cấp grant STAFF:events (admin)")
    @PostMapping("grants")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("isAuthenticated()")
    public StaffGrantResponse grant(
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody Map<String, String> request) {
        return events.grantStaff(subject(jwt), roles(jwt), request == null ? null : request.get("userId"));
    }

    @Operation(summary = "Thu hồi grant (admin)")
    @DeleteMapping("grants/{grantId}")
    @PreAuthorize("isAuthenticated()")
    public void revoke(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String grantId) {
        events.revokeStaff(subject(jwt), roles(jwt), grantId);
    }

    private static String subject(Jwt jwt) {
        if (jwt == null || jwt.getSubject() == null || jwt.getSubject().isBlank()) {
            throw new AccessDeniedException("Not authenticated");
        }
        return jwt.getSubject();
    }

    private static List<String> roles(Jwt jwt) {
        List<String> roles = jwt.getClaimAsStringList("roles");
        return roles == null ? List.of() : roles;
    }
}
