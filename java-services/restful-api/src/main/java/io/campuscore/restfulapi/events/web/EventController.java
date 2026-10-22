package io.campuscore.restfulapi.events.web;

import io.campuscore.restfulapi.events.service.EventStudentService;
import io.campuscore.restfulapi.events.web.EventDtos.EventResponse;
import io.campuscore.restfulapi.events.web.EventDtos.MyRegistrationResponse;
import io.campuscore.restfulapi.events.web.EventDtos.RegistrationResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Student/authenticated event surface. SELF authority: the student id is the
 * JWT subject, never a request parameter. Client-created mutations require
 * {@code Idempotency-Key} (contract §1.3).
 */
@Tag(name = "Events", description = "Sự kiện Đoàn–Hội: đăng ký, hủy đăng ký, lịch sử tham gia")
@RestController
@Profile("persistence")
@RequestMapping("/api/v1/events")
public class EventController {

    private final EventStudentService students;

    public EventController(EventStudentService students) {
        this.students = students;
    }

    @Operation(summary = "Danh sách sự kiện đã công bố")
    @GetMapping
    @PreAuthorize("isAuthenticated()")
    public List<EventResponse> list(@AuthenticationPrincipal Jwt jwt) {
        return students.listPublished(subject(jwt));
    }

    @Operation(summary = "Chi tiết sự kiện")
    @GetMapping("{eventId}")
    @PreAuthorize("isAuthenticated()")
    public EventResponse detail(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String eventId) {
        return students.detail(subject(jwt), eventId);
    }

    @Operation(summary = "Lịch sử đăng ký của tôi")
    @GetMapping("my/registrations")
    @PreAuthorize("isAuthenticated()")
    public List<MyRegistrationResponse> myRegistrations(@AuthenticationPrincipal Jwt jwt) {
        return students.myRegistrations(subject(jwt));
    }

    @Operation(summary = "Đăng ký tham gia sự kiện")
    @PostMapping("{eventId}/register")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('STUDENT')")
    public RegistrationResponse register(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String eventId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return students.register(subject(jwt), eventId, idempotencyKey);
    }

    @Operation(summary = "Hủy đăng ký sự kiện của chính mình")
    @PostMapping("registrations/{registrationId}/cancel")
    @PreAuthorize("hasRole('STUDENT')")
    public RegistrationResponse cancel(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String registrationId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return students.cancel(subject(jwt), registrationId, idempotencyKey);
    }

    private static String subject(Jwt jwt) {
        if (jwt == null || jwt.getSubject() == null || jwt.getSubject().isBlank()) {
            throw new AccessDeniedException("Not authenticated");
        }
        return jwt.getSubject();
    }
}
