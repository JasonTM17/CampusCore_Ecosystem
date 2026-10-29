package io.campuscore.restfulapi.attendance;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.*;
import java.time.Instant;
import java.time.LocalDate;

public final class AttendanceDtos {
    private AttendanceDtos() { }
    @Schema(name="AttendanceOpenSessionRequest")
    public record OpenSessionRequest(
            @NotBlank @Size(max=120) String sectionId, @NotNull LocalDate date,
            Instant opensAt, Instant closesAt, @Min(0) @Max(60) Integer lateAfterMinutes,
            @NotBlank @Size(max=120) String geofenceId, Boolean requireCode) { }
    @Schema(name="AttendanceSessionResponse")
    public record SessionResponse(String id, String sectionId, LocalDate date, String geofenceId,
            Instant opensAt, Instant closesAt, int lateAfterMinutes, boolean requireCode, String status,
            long accepted, long pending, long rejected, long enrolled) { }
    @Schema(name="AttendanceOpenSessionResponse")
    public record OpenSessionResponse(String id, String sectionId, String sectionLabel, Instant closesAt,
            boolean requireCode, String geofenceName) { }
    @Schema(name="AttendanceCodeResponse")
    public record CodeResponse(String code, Instant expiresAt, int stepSeconds) { }
    @Schema(name="AttendanceCheckinRequest")
    public record CheckinRequest(
            @Pattern(regexp="[0-9]{6}") String code,
            @NotNull @DecimalMin("-90") @DecimalMax("90") Double latitude,
            @NotNull @DecimalMin("-180") @DecimalMax("180") Double longitude,
            @NotNull @PositiveOrZero Double accuracyMeters, @NotNull Instant capturedAt,
            @NotNull Boolean mockProvider, @NotBlank @Size(max=200) String installationId,
            @Size(min=16, max=200) @Schema(description="Optional single-use random request nonce; legacy clients use a server-derived request fingerprint") String nonce) {
        @Override public String toString() { return "CheckinRequest[redacted]"; }
    }
    @Schema(name="AttendanceCheckinResponse")
    public record CheckinResponse(String decision, String status, String message) { }
    /** Lecturer views deliberately omit ALL coordinates and device/IP pseudonyms. */
    @Schema(name="AttendanceCheckinView")
    public record CheckinView(String id, String sessionId, String studentId, String decision, String reason,
            double distanceMeters, double accuracyMeters, boolean mockProvider, Instant capturedAt,
            Instant createdAt, String reviewedBy, Instant reviewedAt, String reviewNote) { }
    @Schema(name="AttendanceReviewRequest")
    public record ReviewRequest(@NotBlank @Pattern(regexp="APPROVE|REJECT") String decision,
                                @NotBlank @Size(max=1000) String note) { }
    @Schema(name="AttendanceConsentRequest")
    public record ConsentRequest(@NotBlank @Size(max=40) String version) { }
    @Schema(name="AttendanceConsentResponse")
    public record ConsentResponse(boolean accepted, String version, Instant acceptedAt) { }
    @Schema(name="AttendanceGeofenceRequest")
    public record GeofenceRequest(@NotBlank @Size(max=240) String name,
            @NotBlank @Size(max=60) String campusCode,
            @NotNull @DecimalMin("-90") @DecimalMax("90") Double centerLat,
            @NotNull @DecimalMin("-180") @DecimalMax("180") Double centerLng,
            @NotNull @Min(30) @Max(1000) Integer radiusMeters, @NotNull Boolean isActive,
            @Size(max=500) String note) { }
    @Schema(name="AttendanceGeofenceResponse")
    public record GeofenceResponse(String id, String name, String campusCode, double centerLat,
            double centerLng, int radiusMeters, boolean isActive, String note) { }
    @Schema(name="AttendanceActiveGeofenceResponse")
    public record ActiveGeofenceResponse(String id, String name, String campusCode, double centerLat,
            double centerLng, int radiusMeters) { }
}
