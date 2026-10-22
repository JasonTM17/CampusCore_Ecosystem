package io.campuscore.restfulapi.identity;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Always-on holder for {@link IdentityProperties} binding. The OIDC lane is
 * feature-flagged, but flag-off contexts still need the properties bean —
 * {@code UnifiedSessionAuthority} and {@code IdentityGrantRetentionJob} read
 * {@code properties.getOidc().isEnabled()} at runtime to decide behavior.
 * Binding here keeps that check possible without starting the SAS surface.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(IdentityProperties.class)
public class IdentityModuleConfig {
}
