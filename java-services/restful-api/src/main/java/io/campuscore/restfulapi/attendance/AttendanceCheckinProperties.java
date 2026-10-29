package io.campuscore.restfulapi.attendance;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** Secrets have no insecure fallback; feature operations fail closed until configured. */
@Component
@ConfigurationProperties(prefix = "attendance.checkin")
public class AttendanceCheckinProperties {
    private String pepper = "";
    private String encryptionKey = "";
    private String consentVersion = "1";
    private int coordinateRetentionDays = 30;
    private int attemptRetentionDays = 90;
    public String getPepper() { return pepper; }
    public void setPepper(String value) { pepper = value; }
    public String getEncryptionKey() { return encryptionKey; }
    public void setEncryptionKey(String value) { encryptionKey = value; }
    public String getConsentVersion() { return consentVersion; }
    public void setConsentVersion(String value) { consentVersion = value; }
    public int getCoordinateRetentionDays() { return coordinateRetentionDays; }
    public void setCoordinateRetentionDays(int value) {
        if (value < 1) throw new IllegalArgumentException("Coordinate retention must be positive");
        coordinateRetentionDays = value;
    }
    public int getAttemptRetentionDays() { return attemptRetentionDays; }
    public void setAttemptRetentionDays(int value) {
        if (value < 1) throw new IllegalArgumentException("Attempt retention must be positive");
        attemptRetentionDays = value;
    }
}
