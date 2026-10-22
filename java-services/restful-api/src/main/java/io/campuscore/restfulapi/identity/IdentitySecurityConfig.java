package io.campuscore.restfulapi.identity;

import io.campuscore.restfulapi.auth.repository.AuthUserRepository;
import io.campuscore.restfulapi.web.ApiErrorWriter;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.oauth2.server.authorization.OAuth2AuthorizationServerConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.oauth2.server.authorization.JdbcOAuth2AuthorizationConsentService;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationConsentService;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.client.InMemoryRegisteredClientRepository;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.security.oauth2.server.authorization.oidc.authentication.OidcLogoutAuthenticationToken;
import org.springframework.security.oauth2.server.authorization.settings.AuthorizationServerSettings;
import org.springframework.security.oauth2.server.authorization.settings.ClientSettings;
import org.springframework.security.oauth2.server.authorization.settings.TokenSettings;
import org.springframework.security.oauth2.server.authorization.token.DelegatingOAuth2TokenGenerator;
import org.springframework.security.oauth2.server.authorization.token.JwtGenerator;
import org.springframework.security.oauth2.server.authorization.token.OAuth2AccessTokenGenerator;
import org.springframework.security.oauth2.server.authorization.token.OAuth2RefreshTokenGenerator;
import org.springframework.security.oauth2.server.authorization.token.OAuth2TokenGenerator;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationProvider;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.csrf.CsrfFilter;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.proc.SecurityContext;
import jakarta.servlet.http.HttpServletResponse;

/**
 * OIDC authorization-server surface (identity-contract.md §2.1–2.6). Every
 * bean lives behind {@code identity.oidc.enabled} — flag off means no
 * {@code /oauth2/*} endpoint exists at all (404), while
 * {@link UnifiedSessionAuthority} still revokes server-side. The SAS chain
 * is {@code @Order(1)} with the endpoints matcher as its security matcher,
 * so the business chain's rules stay untouched.
 */
@Configuration
@EnableConfigurationProperties(IdentityProperties.class)
@ConditionalOnProperty(prefix = "identity.oidc", name = "enabled", havingValue = "true")
public class IdentitySecurityConfig {

    @Bean
    @Order(1)
    SecurityFilterChain identityServerChain(
            HttpSecurity http,
            RegisteredClientRepository identityClientRepository,
            OAuth2AuthorizationService identityAuthorizationService,
            OAuth2AuthorizationConsentService identityConsentService,
            AuthorizationServerSettings identityServerSettings,
            OAuth2TokenGenerator<?> identityTokenGenerator,
            JwtDecoder identityJwtDecoder,
            io.campuscore.restfulapi.security.CookieOrBearerTokenResolver tokenResolver,
            AuthUserRepository users, ApiErrorWriter errorWriter,
            UnifiedSessionAuthority authority, IdentitySessionMirror mirror,
            IdentityProperties properties) throws Exception {
        OAuth2AuthorizationServerConfigurer authorizationServer =
                new OAuth2AuthorizationServerConfigurer();
        http
                .securityMatcher(authorizationServer.getEndpointsMatcher())
                .with(authorizationServer, configurer -> configurer
                        .registeredClientRepository(identityClientRepository)
                        .authorizationService(identityAuthorizationService)
                        .authorizationConsentService(identityConsentService)
                        .authorizationServerSettings(identityServerSettings)
                        .tokenGenerator(identityTokenGenerator)
                        .tokenEndpoint(token -> token.errorResponseHandler(
                                new OidcRefreshReplayHandler(mirror, authority,
                                        OidcRefreshReplayHandler.defaultDelegate())))
                        .oidc(oidc -> oidc.logoutEndpoint(logout -> logout
                                .logoutResponseHandler((request, response, authentication) ->
                                        handleLogout(request, response, authentication, authority)))))
                .authorizeHttpRequests(authorize -> authorize.anyRequest().authenticated())
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session ->
                        session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .oauth2ResourceServer(oauth -> oauth
                        .bearerTokenResolver(tokenResolver)
                        .jwt(jwt -> jwt.decoder(identityJwtDecoder)))
                // SAS validates the authorization-code request at position 10
                // (OAuth2AuthorizationCodeRequestValidatingFilter) and caches
                // the converted token — before the resource-server bearer
                // filter at position 15 would set the principal. Silent SSO
                // therefore requires authenticating the central session before
                // the validating filter runs.
                .addFilterAfter(
                        ssoBearerFilter(tokenResolver, identityJwtDecoder,
                                properties.getOidc().getLoginPage()),
                        CsrfFilter.class)
                .exceptionHandling(exceptions -> exceptions.authenticationEntryPoint(
                        (request, response, exception) -> redirectToLogin(request, response,
                                properties.getOidc().getLoginPage())))
                .addFilterAfter(
                        new IdentityAccountGateFilter(users, errorWriter,
                                properties.getOidc().isAuthorizePaused()),
                        BearerTokenAuthenticationFilter.class);
        return http.build();
    }

    @Bean
    RegisteredClientRepository identityClientRepository(IdentityProperties properties,
            PasswordEncoder passwordEncoder) {
        List<RegisteredClient> clients = properties.getClients().stream()
                .map(client -> buildClient(client, passwordEncoder))
                .collect(Collectors.toList());
        // BFF surfaces register as confidential OIDC clients (host-policy §1):
        // each browser surface gets its own client_id, exact callback and
        // post-logout URIs derived from its configured public base.
        for (IdentityProperties.Surface surface : properties.getBff().getSurfaces()) {
            if (!"BFF".equals(surface.getMode()) || surface.getClientId() == null
                    || surface.getClientId().isBlank()) {
                continue;
            }
            if (surface.getPublicBaseUrl().isBlank()) {
                throw new IllegalStateException(
                        "BFF surface " + surface.getId() + " requires public-base-url");
            }
            IdentityProperties.Client client = new IdentityProperties.Client();
            client.setClientId(surface.getClientId());
            client.setClientSecret(surface.getClientSecret());
            client.setRedirectUris(List.of(
                    surface.getPublicBaseUrl() + "/session/callback"));
            client.setPostLogoutRedirectUris(List.of(
                    surface.getPublicBaseUrl() + "/session/logged-out"));
            client.setScopes(List.of("openid"));
            clients.add(buildClient(client, passwordEncoder));
        }
        if (clients.isEmpty()) {
            throw new IllegalStateException(
                    "identity.oidc.enabled requires at least one identity.clients[] entry");
        }
        return new InMemoryRegisteredClientRepository(clients);
    }

    private static RegisteredClient buildClient(IdentityProperties.Client client,
            PasswordEncoder passwordEncoder) {
        if (client.getRedirectUris().isEmpty()) {
            throw new IllegalStateException(
                    "identity client " + client.getClientId() + " has no redirect URIs");
        }
        RegisteredClient.Builder builder = RegisteredClient.withId(client.getClientId())
                .clientId(client.getClientId())
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .authorizationGrantType(AuthorizationGrantType.REFRESH_TOKEN)
                .redirectUris(uris -> uris.addAll(client.getRedirectUris()))
                .postLogoutRedirectUris(uris -> uris.addAll(client.getPostLogoutRedirectUris()))
                .scopes(scopes -> scopes.addAll(client.getScopes()))
                .clientSettings(ClientSettings.builder()
                        .requireProofKey(true)
                        .requireAuthorizationConsent(false)
                        .build())
                .tokenSettings(TokenSettings.builder()
                        .accessTokenTimeToLive(client.getAccessTokenTtl())
                        .refreshTokenTimeToLive(client.getRefreshTokenTtl())
                        .reuseRefreshTokens(false)
                        .build());
        if (client.isPublicClient()) {
            builder.clientAuthenticationMethod(ClientAuthenticationMethod.NONE);
        } else {
            if (client.getClientSecret() == null || client.getClientSecret().isBlank()) {
                throw new IllegalStateException(
                        "confidential identity client " + client.getClientId()
                                + " requires a secret");
            }
            builder.clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
                    .clientSecret(passwordEncoder.encode(client.getClientSecret()));
        }
        return builder.build();
    }

    @Bean
    AuthorizationServerSettings identityServerSettings(IdentityProperties properties) {
        return AuthorizationServerSettings.builder()
                .issuer(properties.getOidc().getIssuerUri())
                .build();
    }

    @Bean
    JWKSource<SecurityContext> identityJwkSource(IdentityProperties properties) {
        return IdentityKeyRing.jwkSource(properties);
    }

    @Bean
    JwtEncoder identityJwtEncoder(JWKSource<SecurityContext> identityJwkSource) {
        NimbusJwtEncoder encoder = new NimbusJwtEncoder(identityJwkSource);
        // The ring publishes active+previous keys for verification overlap;
        // signing always uses the first candidate (active by construction).
        encoder.setJwkSelector(candidates -> candidates.get(0));
        return encoder;
    }

    @Bean
    DeterministicTokenCipher identityCipher(IdentityProperties properties) {
        return new DeterministicTokenCipher(properties.getOidc().getTokenEncryptionKey());
    }

    @Bean
    OAuth2AuthorizationService identityAuthorizationService(
            @Qualifier("identityJdbcOperations") JdbcOperations identityJdbcOperations,
            RegisteredClientRepository identityClientRepository,
            DeterministicTokenCipher identityCipher, AuthUserRepository users,
            IdentitySessionMirror mirror) {
        return new LockingIdentityAuthorizationService(identityJdbcOperations,
                identityClientRepository, identityCipher, users, mirror);
    }

    @Bean
    OAuth2AuthorizationConsentService identityConsentService(
            @Qualifier("identityJdbcOperations") JdbcOperations identityJdbcOperations,
            RegisteredClientRepository identityClientRepository) {
        return new JdbcOAuth2AuthorizationConsentService(identityJdbcOperations,
                identityClientRepository);
    }

    /**
     * Scoped forwarded-header handling for the SAS surface only
     * (identity-contract.md §2.6): the global chain deliberately keeps
     * {@code forward-headers-strategy=none} so client-forged headers cannot
     * spoof IP keys, but the issuer context validation must see the
     * proxy-fronted scheme/host behind a trusted TLS terminator.
     */
    @Bean
    org.springframework.boot.web.servlet.FilterRegistrationBean<org.springframework.web.filter.ForwardedHeaderFilter>
            identityForwardedHeaderFilter() {
        var registration = new org.springframework.boot.web.servlet.FilterRegistrationBean<>(
                new org.springframework.web.filter.ForwardedHeaderFilter());
        registration.setUrlPatterns(java.util.List.of("/oauth2/*", "/.well-known/*", "/connect/*"));
        registration.setName("identityForwardedHeaderFilter");
        // Below the springSecurityFilterChain registration order (-100) so
        // the SAS endpoint filters actually see the rewritten scheme/host.
        registration.setOrder(-200);
        return registration;
    }

    /**
     * Populates {@code RequestContextHolder} before the security chain runs
     * — SAS endpoints terminate inside the chain, before DispatcherServlet,
     * so without this the mirror's request-IP capture (and anything else
     * request-scoped inside the chain) would always see empty attributes.
     */
    @Bean
    org.springframework.boot.web.servlet.FilterRegistrationBean<org.springframework.web.filter.RequestContextFilter>
            identityRequestContextFilter() {
        var registration = new org.springframework.boot.web.servlet.FilterRegistrationBean<>(
                new org.springframework.web.filter.RequestContextFilter());
        registration.setName("identityRequestContextFilter");
        registration.setOrder(-210);
        return registration;
    }

    @Bean
    OAuth2TokenGenerator<?> identityTokenGenerator(JwtEncoder identityJwtEncoder,
            AuthUserRepository users) {
        JwtGenerator jwtGenerator = new JwtGenerator(identityJwtEncoder);
        jwtGenerator.setJwtCustomizer(new IdentityTokenCustomizer(users));
        return new DelegatingOAuth2TokenGenerator(jwtGenerator,
                new OAuth2AccessTokenGenerator(), new OAuth2RefreshTokenGenerator());
    }

    /**
     * Named {@code JwtDecoder} bean; the business chain selects it by name
     * ({@code @Qualifier("identityJwtDecoder") ObjectProvider<JwtDecoder>})
     * so the legacy {@code jwtDecoder} bean stays the unqualified fallback.
     */
    @Bean
    IdentityJwtDecoder identityJwtDecoder(IdentityProperties properties,
            JWKSource<SecurityContext> identityJwkSource,
            @Qualifier("jwtDecoder") JwtDecoder legacyDecoder) {
        Set<String> clientIds = properties.getClients().stream()
                .map(IdentityProperties.Client::getClientId)
                .collect(Collectors.toSet());
        // BFF surface clients are first-class OIDC audiences — their
        // id_tokens must validate against the same ring.
        properties.getBff().getSurfaces().stream()
                .map(IdentityProperties.Surface::getClientId)
                .filter(id -> id != null && !id.isBlank())
                .forEach(clientIds::add);
        String issuer = properties.getOidc().getIssuerUri();
        org.springframework.util.Assert.hasText(issuer,
                "identity.oidc.issuer-uri is required when identity.oidc.enabled");
        return new IdentityJwtDecoder(issuer,
                identityJwkSource, clientIds, legacyDecoder,
                io.campuscore.restfulapi.security.SecurityConfig::requireAccessTokenShape);
    }

    /** Per-client RP-initiated logout: revoke that client's grants, then redirect. */
    private static void handleLogout(jakarta.servlet.http.HttpServletRequest request,
            HttpServletResponse response,
            org.springframework.security.core.Authentication authentication,
            UnifiedSessionAuthority authority) throws IOException {
        if (authentication instanceof OidcLogoutAuthenticationToken logoutToken) {
            String userId = logoutToken.getIdToken() != null
                    ? logoutToken.getIdToken().getSubject() : null;
            String clientId = logoutToken.getClientId();
            if (userId != null && clientId != null) {
                try {
                    authority.revokeClientGrants(userId, clientId, "OIDC_LOGOUT",
                            request.getHeader("X-Request-Id"));
                } catch (RuntimeException revokeFailure) {
                    // Logout UX must not fail on audit trouble; the revoke is
                    // best-effort at the edge and replay-safe server-side.
                    org.slf4j.LoggerFactory.getLogger(IdentitySecurityConfig.class)
                            .warn("OIDC logout revoke failed user={} client={}: {}",
                                    userId, clientId, revokeFailure.toString());
                }
            }
            String redirect = logoutToken.getPostLogoutRedirectUri();
            if (redirect != null && !redirect.isBlank()) {
                String target = redirect + (logoutToken.getState() != null
                        ? (redirect.contains("?") ? "&" : "?")
                                + "state=" + URLEncoder.encode(logoutToken.getState(),
                                        StandardCharsets.UTF_8)
                        : "");
                response.sendRedirect(target);
                return;
            }
        }
        response.setStatus(HttpStatus.NO_CONTENT.value());
    }

    /**
     * Bearer/cookie authentication for the SSO surface, positioned before
     * SAS's pre-validation filter so the cached authorization request carries
     * the real resource-owner principal (see chain comment above).
     */
    private static BearerTokenAuthenticationFilter ssoBearerFilter(
            io.campuscore.restfulapi.security.CookieOrBearerTokenResolver tokenResolver,
            JwtDecoder identityJwtDecoder, String loginPage) {
        JwtAuthenticationProvider provider = new JwtAuthenticationProvider(identityJwtDecoder);
        BearerTokenAuthenticationFilter filter =
                new BearerTokenAuthenticationFilter(new ProviderManager(provider));
        filter.setBearerTokenResolver(tokenResolver);
        filter.setAuthenticationEntryPoint((request, response, exception) ->
                redirectToLogin(request, response, loginPage));
        return filter;
    }

    /** Unauthenticated authorize requests bounce to the login page contract. */
    private static void redirectToLogin(jakarta.servlet.http.HttpServletRequest request,
            HttpServletResponse response, String loginPage) throws IOException {
        String target = request.getRequestURI()
                + (request.getQueryString() != null ? "?" + request.getQueryString() : "");
        response.sendRedirect(loginPage + "?return="
                + URLEncoder.encode(target, StandardCharsets.UTF_8));
    }
}
