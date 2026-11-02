package io.campuscore.restfulapi.identity.bff;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import io.campuscore.restfulapi.auth.repository.AuthUserRepository;
import io.campuscore.restfulapi.identity.IdentityProperties;
import io.campuscore.restfulapi.identity.UnifiedSessionAuthority;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.server.authorization.OAuth2Authorization;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;

class BffSessionLogoutTest {

    private static final String SESSION = "opaque-session";
    private static final String AUTHORIZATION = "authorization-1";
    private static final String CLIENT = "portal-client";
    private static final String ID_TOKEN_HINT = "header.payload+signature/=";

    private final BffSessionStore store = mock(BffSessionStore.class);
    private final OAuth2AuthorizationService authorizations = mock(OAuth2AuthorizationService.class);
    private final AuthUserRepository users = mock(AuthUserRepository.class);
    private final UnifiedSessionAuthority authority = mock(UnifiedSessionAuthority.class);
    private final IdentityProperties properties = new IdentityProperties();
    private final IdentityProperties.Surface surface = new IdentityProperties.Surface();
    private final BffSessionService service = new BffSessionService(
            properties, store, null, null,
            authorizations, users, authority, null);

    @BeforeEach
    void setUp() {
        properties.getBff().setIssuerPublic("https://identity.test");
        surface.setId("portal");
        surface.setClientId(CLIENT);
    }

    @Test
    void logoutCapturesHintBeforeDeletingBffSessionsAndLeavesGrantForIdentityServer() {
        when(store.findSession(SESSION, "portal")).thenReturn(session(null));
        when(authorizations.findById(AUTHORIZATION)).thenReturn(grantWithIdTokenHint());
        when(store.revokeSession(SESSION, "portal")).thenReturn(1);

        BffSessionService.LogoutResult result =
                service.logout(surface, "https://portal.test", SESSION);

        assertThat(result.logoutUrl()).contains("id_token_hint="
                + URLEncoder.encode(ID_TOKEN_HINT, StandardCharsets.UTF_8));
        InOrder order = inOrder(authorizations, users, store);
        order.verify(store).findSession(SESSION, "portal");
        order.verify(users).lockUserRow("user-1");
        order.verify(authorizations).findById(AUTHORIZATION);
        order.verify(store).revokeSession(SESSION, "portal");
        order.verify(store).markClientLogoutPending("user-1", CLIENT);
        order.verify(store).deleteSessionsForClient("user-1", CLIENT);
        verify(authority, never()).revokeClientGrants(
                "user-1", CLIENT, "BFF_LOGOUT", null);
    }

    @Test
    void revokeRaceDoesNotReturnAHintFromTheSessionThatLostTheRace() {
        when(store.findSession(SESSION, "portal")).thenReturn(session(null));
        when(authorizations.findById(AUTHORIZATION)).thenReturn(grantWithIdTokenHint());
        when(store.revokeSession(SESSION, "portal")).thenReturn(0);

        BffSessionService.LogoutResult result =
                service.logout(surface, "https://portal.test", SESSION);

        assertThat(result.logoutUrl()).doesNotContain("id_token_hint=");
        verify(store, never()).deleteSessionsForClient("user-1", CLIENT);
        verify(store, never()).markClientLogoutPending("user-1", CLIENT);
        verify(authority, never()).revokeClientGrants(
                "user-1", CLIENT, "BFF_LOGOUT", null);
    }

    @Test
    void revokedSessionDoesNotReuseItsHintOrRevokeAnotherServerSideGrant() {
        when(store.findSession(SESSION, "portal"))
                .thenReturn(session(Instant.now().minusSeconds(1)));

        BffSessionService.LogoutResult result =
                service.logout(surface, "https://portal.test", SESSION);

        assertThat(result.logoutUrl()).doesNotContain("id_token_hint=");
        verify(store).findSession(SESSION, "portal");
        verifyNoInteractions(authorizations, users, authority);
    }

    private BffSessionStore.Session session(Instant revokedAt) {
        return new BffSessionStore.Session("hash", "user-1", "portal", CLIENT,
                AUTHORIZATION, "csrf-ciphertext", Instant.now().plusSeconds(600), revokedAt);
    }

    private OAuth2Authorization grantWithIdTokenHint() {
        Instant issuedAt = Instant.now();
        OidcIdToken idToken = new OidcIdToken(ID_TOKEN_HINT, issuedAt,
                issuedAt.plusSeconds(300), Map.of(
                        "iss", "https://identity.test", "sub", "user-1", "aud", CLIENT));
        RegisteredClient client = RegisteredClient.withId(CLIENT)
                .clientId(CLIENT)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri("https://portal.test/session/callback")
                .build();
        return OAuth2Authorization.withRegisteredClient(client)
                .id(AUTHORIZATION)
                .principalName("user-1")
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .token(idToken)
                .build();
    }
}
