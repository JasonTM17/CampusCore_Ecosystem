package io.campuscore.restfulapi.attendance;

import static io.campuscore.restfulapi.attendance.AttendanceDtos.*;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@Tag(name="Attendance Check-in",description="Phiên điểm danh có xác minh vị trí")
@RestController
@Validated
@Profile("persistence")
@RequestMapping("/api/v1/attendance")
public class AttendanceSessionController {
    private final SessionService sessions;
    private final CheckinService checkins;
    public AttendanceSessionController(SessionService sessions,CheckinService checkins) { this.sessions=sessions;this.checkins=checkins; }
    @PostMapping("/sessions")
    @PreAuthorize("hasAnyRole('LECTURER','ADMIN','SUPER_ADMIN')")
    @Operation(operationId="attendanceOpenSession",summary="Mở phiên điểm danh theo vị trí")
    @ApiResponses(@ApiResponse(responseCode="201",description="Phiên đã mở",
            content=@Content(schema=@Schema(implementation=SessionResponse.class))))
    public ResponseEntity<SessionResponse> open(@AuthenticationPrincipal Jwt jwt,@Valid @RequestBody OpenSessionRequest r) {
        return ResponseEntity.status(201).body(sessions.open(r,jwt.getSubject(),jwt.getClaimAsString("lecturerId"),jwt.getClaimAsStringList("roles")));
    }
    @GetMapping("/sessions/{id}")
    @PreAuthorize("hasAnyRole('LECTURER','ADMIN','SUPER_ADMIN')")
    @Operation(operationId="attendanceGetSession",summary="Xem phiên điểm danh và số lượng kết quả")
    public SessionResponse get(@AuthenticationPrincipal Jwt jwt,@PathVariable @Size(max=120) String id) {
        return sessions.get(id,jwt.getClaimAsString("lecturerId"),jwt.getClaimAsStringList("roles"));
    }
    @GetMapping("/sessions/{id}/code")
    @PreAuthorize("hasAnyRole('LECTURER','ADMIN','SUPER_ADMIN')")
    @Operation(operationId="attendanceGetCode",summary="Lấy mã điểm danh hiện tại",description="Mã đổi mỗi 30 giây. Không lưu bộ nhớ đệm.")
    public ResponseEntity<CodeResponse> code(@AuthenticationPrincipal Jwt jwt,@PathVariable @Size(max=120) String id) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(sessions.code(id,jwt.getClaimAsString("lecturerId"),jwt.getClaimAsStringList("roles")));
    }
    @PostMapping("/sessions/{id}/close")
    @PreAuthorize("hasAnyRole('LECTURER','ADMIN','SUPER_ADMIN')")
    @Operation(operationId="attendanceCloseSession",summary="Đóng phiên điểm danh")
    public SessionResponse close(@AuthenticationPrincipal Jwt jwt,@PathVariable @Size(max=120) String id) {
        return sessions.close(id,jwt.getSubject(),jwt.getClaimAsString("lecturerId"),jwt.getClaimAsStringList("roles"));
    }
    @GetMapping("/sessions/{id}/checkins")
    @PreAuthorize("hasAnyRole('LECTURER','ADMIN','SUPER_ADMIN')")
    @Operation(operationId="attendanceListCheckins",summary="Xem danh sách điểm danh cần kiểm tra",description="Không trả tọa độ hoặc mã thiết bị của sinh viên.")
    public List<CheckinView> list(@AuthenticationPrincipal Jwt jwt,@PathVariable @Size(max=120) String id) {
        return sessions.checkins(id,jwt.getClaimAsString("lecturerId"),jwt.getClaimAsStringList("roles"));
    }
    @PostMapping("/checkins/{id}/review")
    @PreAuthorize("hasAnyRole('LECTURER','ADMIN','SUPER_ADMIN')")
    @Operation(operationId="attendanceReviewCheckin",summary="Duyệt hoặc từ chối điểm danh nghi vấn")
    public CheckinView review(@AuthenticationPrincipal Jwt jwt,@PathVariable @Size(max=120) String id,@Valid @RequestBody ReviewRequest r) {
        return checkins.review(id,r,jwt.getSubject(),jwt.getClaimAsString("lecturerId"),jwt.getClaimAsStringList("roles"));
    }
    @GetMapping("/sessions/open")
    @PreAuthorize("hasRole('STUDENT')")
    @Operation(operationId="attendanceOpenForStudent",summary="Xem phiên điểm danh đang mở của sinh viên")
    public List<OpenSessionResponse> openForStudent(@AuthenticationPrincipal Jwt jwt) {
        return sessions.openForStudent(student(jwt));
    }
    static String student(Jwt jwt) {
        String student=jwt.getClaimAsString("studentId");
        if(student==null || student.isBlank()) throw SessionService.failure(org.springframework.http.HttpStatus.FORBIDDEN,"NOT_ENROLLED");
        return student;
    }
}
