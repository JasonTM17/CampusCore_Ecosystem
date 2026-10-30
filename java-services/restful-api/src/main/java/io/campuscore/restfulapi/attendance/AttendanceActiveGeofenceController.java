package io.campuscore.restfulapi.attendance;

import static io.campuscore.restfulapi.attendance.AttendanceDtos.*;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import org.springframework.context.annotation.Profile;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name="Attendance Geofences",description="Active options for opening an attendance session")
@RestController
@Profile("persistence")
@RequestMapping("/api/v1/attendance/geofences")
public class AttendanceActiveGeofenceController {
    private final GeofenceService service;
    public AttendanceActiveGeofenceController(GeofenceService service) { this.service=service; }

    @GetMapping("/active")
    @PreAuthorize("hasAnyRole('LECTURER','ADMIN','SUPER_ADMIN')")
    @Operation(operationId="attendanceListActiveGeofences",summary="List active geofences for session setup")
    public List<ActiveGeofenceResponse> listActive() { return service.listActive(); }
}
