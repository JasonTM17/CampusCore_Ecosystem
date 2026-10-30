package io.campuscore.restfulapi.notification.push;

import io.campuscore.restfulapi.audit.AdminAuditRecorder;
import io.campuscore.restfulapi.exception.AppException;
import io.campuscore.restfulapi.notification.push.PushDeviceDtos.PushDeviceRegistrationRequest;
import io.campuscore.restfulapi.notification.push.PushDeviceDtos.PushDeviceRegistrationResponse;
import java.time.Clock;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Owner identity comes exclusively from the authenticated JWT subject. */
@Service
@Profile("persistence")
public class PushDeviceService {

    private static final Pattern LABEL = Pattern.compile("[A-Za-z0-9_-]{1,40}");
    private static final Pattern INSTALLATION = Pattern.compile("[A-Za-z0-9._:-]{1,200}");
    private static final int MAX_TOKEN_LENGTH = 4_096;

    private final PushDeviceRepository registrations;
    private final PushTokenCryptography cryptography;
    private final AdminAuditRecorder audit;
    private final Clock clock;

    @Autowired
    public PushDeviceService(
            PushDeviceRepository registrations,
            PushTokenCryptography cryptography,
            AdminAuditRecorder audit) {
        this(registrations, cryptography, audit, Clock.systemUTC());
    }

    PushDeviceService(
            PushDeviceRepository registrations,
            PushTokenCryptography cryptography,
            AdminAuditRecorder audit,
            Clock clock) {
        this.registrations = registrations;
        this.cryptography = cryptography;
        this.audit = audit;
        this.clock = clock;
    }

    @Transactional
    public PushDeviceRegistrationResponse register(
            String actorId, String installationId, PushDeviceRegistrationRequest request) {
        String owner = requireSubject(actorId);
        String installation = requireInstallation(installationId);
        String provider = requireLabel(request.provider(), "provider");
        String platform = requireLabel(request.platform(), "platform");
        String token = requireToken(request.token());

        // Fail closed before any registration write when the reviewed key is absent.
        String ciphertext = cryptography.encrypt(token);
        String fingerprint = cryptography.fingerprint(token);
        Instant now = clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MICROS);
        PushDeviceRepository.RegistrationMutation result = registrations.register(
                owner, installation, provider, platform, ciphertext, fingerprint, now);
        if (result.previousOwnerId() != null) {
            audit.record(owner, null, "PUSH_DEVICE_REBOUND", "DEVICE_REGISTRATION",
                    result.deviceId(), null,
                    Map.of("ownerId", result.previousOwnerId()), Map.of("ownerId", owner));
        }
        return new PushDeviceRegistrationResponse(
                installation, result.provider(), result.platform(), result.status(), result.updatedAt());
    }

    @Transactional
    public void delete(String actorId, String installationId) {
        registrations.revoke(
                requireSubject(actorId), requireInstallation(installationId),
                clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MICROS));
    }

    private static String requireSubject(String value) {
        if (value == null || value.isBlank()) {
            throw new AppException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED",
                    "Authentication is required");
        }
        return value;
    }

    private static String requireInstallation(String value) {
        if (value == null || !INSTALLATION.matcher(value).matches()) {
            throw invalidRequest();
        }
        return value;
    }

    private static String requireLabel(String value, String field) {
        if (value == null || !LABEL.matcher(value).matches()) {
            throw invalidRequest();
        }
        return value.toUpperCase(Locale.ROOT);
    }

    private static String requireToken(String value) {
        if (value == null || value.isBlank() || value.length() > MAX_TOKEN_LENGTH
                || !value.equals(value.trim())
                || value.chars().anyMatch(character -> character < 0x20 || character == 0x7f)) {
            throw new AppException(HttpStatus.BAD_REQUEST, "DEVICE_TOKEN_INVALID",
                    "Push device token is invalid");
        }
        return value;
    }

    private static AppException invalidRequest() {
        return new AppException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                "Push device registration request is invalid");
    }
}
