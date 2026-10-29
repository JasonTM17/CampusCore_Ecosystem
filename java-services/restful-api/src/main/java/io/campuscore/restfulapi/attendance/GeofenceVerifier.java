package io.campuscore.restfulapi.attendance;

import java.time.Clock;
import java.time.Instant;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

/** Pure circle verification; the caller never supplies the verdict. */
@Component
public class GeofenceVerifier {
    private final Clock clock;
    public GeofenceVerifier(@Qualifier("attendanceClock") Clock clock) { this.clock = clock; }
    public record Verdict(String decision, String reason, double distanceMeters) { }

    public Verdict verify(double lat, double lng, double accuracy, Instant capturedAt,
                          double centerLat, double centerLng, int radius) {
        if (!coordinate(lat, lng) || !coordinate(centerLat, centerLng) || radius < 30 || radius > 1000
                || !Double.isFinite(accuracy) || accuracy < 0 || capturedAt == null
                || capturedAt.isBefore(clock.instant().minusSeconds(60))
                || capturedAt.isAfter(clock.instant().plusSeconds(10))) {
            return new Verdict("REJECTED", "INVALID_LOCATION", 0);
        }
        double distance = distance(lat, lng, centerLat, centerLng);
        if (accuracy > 100) return new Verdict("REJECTED", "LOW_ACCURACY", distance);
        if (distance - accuracy > radius) return new Verdict("REJECTED", "OUTSIDE_AREA", distance);
        if (distance <= radius && accuracy <= 50) return new Verdict("ACCEPTED", "INSIDE", distance);
        return new Verdict("PENDING_REVIEW", "BORDERLINE", distance);
    }

    public static boolean coordinate(double lat, double lng) {
        return Double.isFinite(lat) && Double.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    }
    public static double distance(double lat, double lng, double otherLat, double otherLng) {
        double dLat = Math.toRadians(otherLat - lat), dLng = Math.toRadians(otherLng - lng);
        double a = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(Math.toRadians(lat))
                * Math.cos(Math.toRadians(otherLat)) * Math.pow(Math.sin(dLng / 2), 2);
        return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))));
    }
}
