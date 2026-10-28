package io.campuscore.restfulapi.notification.push;

import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * Safe default: no provider is wired, so dispatch stays BLOCKED. A real adapter replaces this bean
 * by being declared {@code @Primary}.
 */
@Component
@Profile("persistence")
public class UnconfiguredPushProvider implements PushProvider {

    @Override
    public boolean isConfigured() {
        return false;
    }

    @Override
    public DeliveryReceipt send(String provider, String token, PushPayload payload, String deliveryKey) {
        throw new IllegalStateException("Push provider is not configured");
    }
}
