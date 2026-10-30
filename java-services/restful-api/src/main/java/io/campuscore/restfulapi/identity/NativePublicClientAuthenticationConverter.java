package io.campuscore.restfulapi.identity;

import jakarta.servlet.http.HttpServletRequest;
import java.util.HashMap;
import java.util.Map;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2ErrorCodes;
import org.springframework.security.oauth2.core.endpoint.OAuth2ParameterNames;
import org.springframework.security.oauth2.server.authorization.authentication.OAuth2ClientAuthenticationToken;
import org.springframework.security.web.authentication.AuthenticationConverter;
import org.springframework.util.StringUtils;

/**
 * Complement to the stock {@code PublicClientAuthenticationConverter}
 * (docs/ecosystem/mobile-policy.md §3, KM-3 probe finding). SAS only converts
 * {@code client_id}-only requests when they carry a {@code code_verifier} on
 * the authorization_code grant ({@code matchesPkceTokenRequest}); a native
 * client presenting just {@code client_id} on the refresh_token grant,
 * {@code /oauth2/revoke}, {@code /oauth2/introspect}, or device endpoints was
 * left anonymous and denied. This converter authenticates the same
 * {@code client_id}-only shape for those other requests — identification
 * only, the token remains the credential. Registered last in the
 * client-auth converter list so every stock converter keeps precedence;
 * {@code PublicClientAuthenticationProvider} then rejects anything whose
 * registered methods don't include {@code NONE} (fail-closed for
 * confidential clients).
 */
final class NativePublicClientAuthenticationConverter implements AuthenticationConverter {

    @Override
    public Authentication convert(HttpServletRequest request) {
        if (!"POST".equals(request.getMethod())) {
            return null;
        }
        String[] clientIds = request.getParameterValues(OAuth2ParameterNames.CLIENT_ID);
        if (clientIds == null || clientIds.length == 0) {
            // No client_id at all — leave it anonymous so the authorization
            // layer denies exactly as it does today.
            return null;
        }
        String clientId = clientIds[0];
        if (clientIds.length != 1 || !StringUtils.hasText(clientId)) {
            throw new OAuth2AuthenticationException(OAuth2ErrorCodes.INVALID_REQUEST);
        }
        Map<String, Object> additionalParameters = new HashMap<>();
        request.getParameterMap().forEach((name, values) -> {
            if (!OAuth2ParameterNames.CLIENT_ID.equals(name) && values != null) {
                additionalParameters.put(name, values.length == 1 ? values[0] : values);
            }
        });
        return new OAuth2ClientAuthenticationToken(clientId, ClientAuthenticationMethod.NONE,
                null, additionalParameters);
    }
}
