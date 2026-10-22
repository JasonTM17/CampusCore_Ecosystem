package io.campuscore.restfulapi.identity;

import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2ErrorCodes;
import org.springframework.security.oauth2.core.endpoint.OAuth2ParameterNames;
import org.springframework.security.oauth2.server.authorization.authentication.OAuth2ClientAuthenticationToken;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.util.Assert;

/**
 * Complement to the stock {@code PublicClientAuthenticationProvider}
 * (docs/ecosystem/mobile-policy.md §3, KM-3 probe finding). The stock provider
 * calls {@code CodeVerifierAuthenticator.authenticateRequired}, which throws
 * {@code invalid_grant} for any request that is not an authorization_code
 * grant carrying a verifier — so a public client's refresh_token grant,
 * {@code /oauth2/revoke}, {@code /oauth2/introspect}, or device-flow request
 * could never authenticate even though {@code client_id}-only is the correct
 * public-client credential there (the refresh token itself is the secret).
 * This provider is registered FIRST: it returns null for authorization_code
 * requests so the stock provider keeps owning PKCE verification there, and
 * authenticates the same NONE-client shape for every other grant. Registered
 * clients that are not {@code NONE} are still rejected — fail-closed.
 */
final class NativePublicClientAuthenticationProvider implements AuthenticationProvider {

    private final RegisteredClientRepository registeredClientRepository;

    NativePublicClientAuthenticationProvider(RegisteredClientRepository registeredClientRepository) {
        Assert.notNull(registeredClientRepository, "registeredClientRepository cannot be null");
        this.registeredClientRepository = registeredClientRepository;
    }

    @Override
    public Authentication authenticate(Authentication authentication) throws AuthenticationException {
        OAuth2ClientAuthenticationToken clientAuthentication =
                (OAuth2ClientAuthenticationToken) authentication;
        if (!ClientAuthenticationMethod.NONE.equals(
                clientAuthentication.getClientAuthenticationMethod())) {
            return null;
        }
        if (isAuthorizationCodeGrant(clientAuthentication)) {
            // The stock provider owns these: PKCE verification is mandatory.
            return null;
        }
        RegisteredClient registeredClient = this.registeredClientRepository
                .findByClientId(clientAuthentication.getPrincipal().toString());
        if (registeredClient == null || !registeredClient.getClientAuthenticationMethods()
                .contains(clientAuthentication.getClientAuthenticationMethod())) {
            throw invalidClient("authentication_method");
        }
        return new OAuth2ClientAuthenticationToken(registeredClient,
                clientAuthentication.getClientAuthenticationMethod(),
                clientAuthentication.getCredentials());
    }

    @Override
    public boolean supports(Class<?> authentication) {
        return OAuth2ClientAuthenticationToken.class.isAssignableFrom(authentication);
    }

    /** Mirrors {@code CodeVerifierAuthenticator.authorizationCodeGrant}. */
    private static boolean isAuthorizationCodeGrant(
            OAuth2ClientAuthenticationToken clientAuthentication) {
        java.util.Map<String, Object> parameters = clientAuthentication.getAdditionalParameters();
        return AuthorizationGrantType.AUTHORIZATION_CODE.getValue()
                .equals(parameters.get(OAuth2ParameterNames.GRANT_TYPE))
                && parameters.get(OAuth2ParameterNames.CODE) != null;
    }

    private static OAuth2AuthenticationException invalidClient(String parameterName) {
        return new OAuth2AuthenticationException(new OAuth2Error(OAuth2ErrorCodes.INVALID_CLIENT,
                "Client authentication failed: " + parameterName, null));
    }
}
