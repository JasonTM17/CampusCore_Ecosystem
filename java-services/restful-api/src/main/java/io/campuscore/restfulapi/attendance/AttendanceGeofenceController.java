package io.campuscore.restfulapi.attendance;

import static io.campuscore.restfulapi.attendance.AttendanceDtos.*;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@Tag(name="Attendance Geofences",description="Quản trị vùng điểm danh; vô hiệu hóa thay vì xóa")
@RestController
@Validated
@Profile("persistence")
@RequestMapping("/api/v1/admin/attendance/geofences")
public class AttendanceGeofenceController {
    private final GeofenceService service;
    public AttendanceGeofenceController(GeofenceService service) { this.service=service; }
    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN','SUPER_ADMIN')")
    @Operation(operationId="attendanceListGeofences",summary="Danh sách vùng điểm danh")
    public List<GeofenceResponse> list() { return service.list(); }
    @PostMapping
    @PreAuthorize("hasAnyRole('ADMIN','SUPER_ADMIN')")
    @Operation(operationId="attendanceCreateGeofence",summary="Tạo vùng điểm danh đã xác minh tọa độ")
    public ResponseEntity<GeofenceResponse> create(@AuthenticationPrincipal Jwt jwt,@Valid @RequestBody GeofenceRequest r) {
        return ResponseEntity.status(201).body(service.save(null,r,jwt.getSubject()));
    }
    @PutMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN','SUPER_ADMIN')")
    @Operation(operationId="attendanceUpdateGeofence",summary="Cập nhật hoặc vô hiệu hóa vùng điểm danh")
    public GeofenceResponse update(@AuthenticationPrincipal Jwt jwt,@PathVariable @Size(max=120) String id,@Valid @RequestBody GeofenceRequest r) {
        return service.save(id,r,jwt.getSubject());
    }
}
