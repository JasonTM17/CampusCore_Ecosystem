package io.campuscore.restfulapi.notification.push;

import io.campuscore.restfulapi.notification.push.PushDeviceDtos.PushDeviceRegistrationRequest;
import io.campuscore.restfulapi.notification.push.PushDeviceDtos.PushDeviceRegistrationResponse;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Device endpoints scoped to the authenticated account. */
@RestController
@Profile("persistence")
@RequestMapping("/api/v1/notifications/my/devices")
public class PushDeviceController {

    private final PushDeviceService devices;

    public PushDeviceController(PushDeviceService devices) {
        this.devices = devices;
    }

    @PutMapping("/{installationId}")
    @ResponseStatus(HttpStatus.OK)
    public PushDeviceRegistrationResponse register(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String installationId,
            @RequestBody(required = false) tools.jackson.databind.JsonNode body) {
        return devices.register(subject(jwt), installationId, PushDeviceRegistrationRequest.from(body));
    }

    @DeleteMapping("/{installationId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal Jwt jwt, @PathVariable String installationId) {
        devices.delete(subject(jwt), installationId);
    }

    private static String subject(Jwt jwt) {
        return jwt == null ? null : jwt.getSubject();
    }
}
