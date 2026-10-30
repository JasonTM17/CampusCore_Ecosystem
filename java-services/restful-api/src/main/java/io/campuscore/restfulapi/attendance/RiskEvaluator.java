package io.campuscore.restfulapi.attendance;

import io.campuscore.restfulapi.web.DomainException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class RiskEvaluator {
    private final AttendanceCheckinProperties properties;
    public RiskEvaluator(AttendanceCheckinProperties properties) { this.properties = properties; }
    public record Position(double lat, double lng, Instant capturedAt) { }

    /** Domain-separated SHA-256 peppered pseudonyms. Neither raw installation id nor IP is stored. */
    public String hash(String domain, String value) {
        if (properties.getPepper() == null || properties.getPepper().length() < 32) {
            throw new DomainException(HttpStatus.SERVICE_UNAVAILABLE, "CHECKIN_NOT_CONFIGURED", "Attendance privacy pepper is not configured");
        }
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(
                    (properties.getPepper() + "\0" + domain + "\0" + value).getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException failure) { throw new IllegalStateException(failure); }
    }
    public List<String> evaluate(boolean mock, double accuracy, Position current, Position previous,
                                 boolean sharedDevice, int otherStudentsAtPosition) {
        List<String> reasons = new ArrayList<>();
        if (sharedDevice) reasons.add("SHARED_DEVICE");
        if (mock) reasons.add("MOCK_PROVIDER");
        if (accuracy == 0) reasons.add("ZERO_ACCURACY");
        if (otherStudentsAtPosition >= 3) reasons.add("IDENTICAL_COORDINATES");
        if (previous != null) {
            double meters = GeofenceVerifier.distance(previous.lat(), previous.lng(), current.lat(), current.lng());
            double seconds = Duration.between(previous.capturedAt(), current.capturedAt()).toMillis() / 1000.0;
            if ((seconds <= 0 && meters > 0) || (seconds > 0 && meters / seconds * 3.6 > 150)) reasons.add("IMPOSSIBLE_SPEED");
        }
        return List.copyOf(reasons);
    }
}
