package io.campuscore.restfulapi.identity;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Identity authority configuration (docs/ecosystem/identity-contract.md).
 * Bound under {@code identity.*}; the whole OIDC surface is gated by
 * {@link Oidc#enabled} and defaults OFF — schema expand ships before enable.
 */
@ConfigurationProperties(prefix = "identity")
public class IdentityProperties {

    private final Oidc oidc = new Oidc();
    private final Retention retention = new Retention();
    private final Bff bff = new Bff();
    private List<Key> keys = new ArrayList<>();
    private List<Client> clients = new ArrayList<>();

    public Oidc getOidc() {
        return oidc;
    }

    public Bff getBff() {
        return bff;
    }

    public Retention getRetention() {
        return retention;
    }

    public List<Key> getKeys() {
        return keys;
    }

    public void setKeys(List<Key> keys) {
        this.keys = keys == null ? new ArrayList<>() : keys;
    }

    public List<Client> getClients() {
        return clients;
    }

    public void setClients(List<Client> clients) {
        this.clients = clients == null ? new ArrayList<>() : clients;
    }

    /** Flag matrix contract row: enabled=false removes the whole SAS chain. */
    public static class Oidc {
        private boolean enabled = false;
        private boolean authorizePaused = false;
        private boolean devKeygen = false;
        private String issuerUri = "http://127.0.0.1:4010";
        private String loginPage = "/login";
        /**
         * Base64-encoded 32-byte AES key encrypting *_token_value columns at
         * rest (AES-256-GCM, deterministic nonce = SHA-256(plaintext)[0:12]).
         * No default — enabling OIDC without the key fails fast.
         */
        private String tokenEncryptionKey = "";
        /**
         * Public clients (ClientAuthenticationMethod.NONE) allowlisted to
         * receive refresh tokens at the authorization-code exchange. SAS
         * suppresses refresh issuance for public clients in
         * {@code OAuth2RefreshTokenGenerator} by default; native apps per
         * RFC 8252 keep the token in SecureStore and rotate on every use,
         * so {@code cu-mobile} is listed explicitly — any unlisted public
         * client keeps the stock no-refresh behavior.
         */
        private List<String> nativeRefreshClientIds = new ArrayList<>();

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public boolean isAuthorizePaused() {
            return authorizePaused;
        }

        public void setAuthorizePaused(boolean authorizePaused) {
            this.authorizePaused = authorizePaused;
        }

        public boolean isDevKeygen() {
            return devKeygen;
        }

        public void setDevKeygen(boolean devKeygen) {
            this.devKeygen = devKeygen;
        }

        public String getIssuerUri() {
            return issuerUri;
        }

        public void setIssuerUri(String issuerUri) {
            this.issuerUri = issuerUri;
        }

        public String getLoginPage() {
            return loginPage;
        }

        public void setLoginPage(String loginPage) {
            this.loginPage = loginPage;
        }

        public String getTokenEncryptionKey() {
            return tokenEncryptionKey;
        }

        public void setTokenEncryptionKey(String tokenEncryptionKey) {
            this.tokenEncryptionKey = tokenEncryptionKey;
        }

        public List<String> getNativeRefreshClientIds() {
            return nativeRefreshClientIds;
        }

        public void setNativeRefreshClientIds(List<String> nativeRefreshClientIds) {
            this.nativeRefreshClientIds =
                    nativeRefreshClientIds == null ? new ArrayList<>() : nativeRefreshClientIds;
        }
    }

    /** Asymmetric signing ring: every key publishes to JWKS; `active` signs. */
    public static class Key {
        private String kid;
        private boolean active;
        private String privateKeyPem;
        private String publicKeyPem;

        public String getKid() {
            return kid;
        }

        public void setKid(String kid) {
            this.kid = kid;
        }

        public boolean isActive() {
            return active;
        }

        public void setActive(boolean active) {
            this.active = active;
        }

        public String getPrivateKeyPem() {
            return privateKeyPem;
        }

        public void setPrivateKeyPem(String privateKeyPem) {
            this.privateKeyPem = privateKeyPem;
        }

        public String getPublicKeyPem() {
            return publicKeyPem;
        }

        public void setPublicKeyPem(String publicKeyPem) {
            this.publicKeyPem = publicKeyPem;
        }
    }

    /**
     * Config-driven registered client. Browser surfaces are confidential
     * (secret from env, bcrypt-hashed at boot); native clients are public
     * with PKCE S256 required.
     */
    public static class Client {
        private String clientId;
        private String clientSecret;
        private boolean publicClient;
        private List<String> redirectUris = new ArrayList<>();
        private List<String> postLogoutRedirectUris = new ArrayList<>();
        private List<String> scopes = new ArrayList<>();
        private Duration accessTokenTtl = Duration.ofMinutes(15);
        private Duration refreshTokenTtl = Duration.ofDays(7);

        public String getClientId() {
            return clientId;
        }

        public void setClientId(String clientId) {
            this.clientId = clientId;
        }

        public String getClientSecret() {
            return clientSecret;
        }

        public void setClientSecret(String clientSecret) {
            this.clientSecret = clientSecret;
        }

        public boolean isPublicClient() {
            return publicClient;
        }

        public void setPublicClient(boolean publicClient) {
            this.publicClient = publicClient;
        }

        public List<String> getRedirectUris() {
            return redirectUris;
        }

        public void setRedirectUris(List<String> redirectUris) {
            this.redirectUris = redirectUris;
        }

        public List<String> getPostLogoutRedirectUris() {
            return postLogoutRedirectUris;
        }

        public void setPostLogoutRedirectUris(List<String> postLogoutRedirectUris) {
            this.postLogoutRedirectUris = postLogoutRedirectUris;
        }

        public List<String> getScopes() {
            return scopes;
        }

        public void setScopes(List<String> scopes) {
            this.scopes = scopes;
        }

        public Duration getAccessTokenTtl() {
            return accessTokenTtl;
        }

        public void setAccessTokenTtl(Duration accessTokenTtl) {
            this.accessTokenTtl = accessTokenTtl;
        }

        public Duration getRefreshTokenTtl() {
            return refreshTokenTtl;
        }

        public void setRefreshTokenTtl(Duration refreshTokenTtl) {
            this.refreshTokenTtl = refreshTokenTtl;
        }
    }

    /**
     * Browser BFF lane (docs/ecosystem/host-policy.md). One confidential OIDC
     * client per browser surface; browser holds only an opaque host-only
     * cookie, every token lives server-side.
     */
    public static class Bff {
        private boolean enabled = false;
        /**
         * Unprefixed dev cookie names + Secure off — allowed ONLY on
         * local/test/e2e profiles; startup fails otherwise (§8 flag matrix).
         */
        private boolean devHttp = false;
        /** Loopback base used for server-side /oauth2/token calls. */
        private String issuerLoopback = "http://127.0.0.1:4010";
        /** Public issuer base seen by browsers (the id host). */
        private String issuerPublic = "http://127.0.0.1:4010";
        /** Opaque session lifetime; also the cookie Max-Age. */
        private Duration sessionTtl = Duration.ofHours(12);
        private Duration transactionTtl = Duration.ofMinutes(5);
        private List<Surface> surfaces = new ArrayList<>();
        private List<String> apiAllowlist = new ArrayList<>();
        /**
         * GET/HEAD prefixes that may be proxied without a session (P06 public
         * content lane): the upstream SecurityConfig permitAll set is the
         * authority — this list only admits truly anonymous reads, and a
         * present-but-invalid session cookie still fails closed instead of
         * silently downgrading to anonymous.
         */
        private List<String> publicApiAllowlist = new ArrayList<>();

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public boolean isDevHttp() {
            return devHttp;
        }

        public void setDevHttp(boolean devHttp) {
            this.devHttp = devHttp;
        }

        public String getIssuerLoopback() {
            return issuerLoopback;
        }

        public void setIssuerLoopback(String issuerLoopback) {
            this.issuerLoopback = issuerLoopback;
        }

        public String getIssuerPublic() {
            return issuerPublic;
        }

        public void setIssuerPublic(String issuerPublic) {
            this.issuerPublic = issuerPublic;
        }

        public Duration getSessionTtl() {
            return sessionTtl;
        }

        public void setSessionTtl(Duration sessionTtl) {
            this.sessionTtl = sessionTtl;
        }

        public Duration getTransactionTtl() {
            return transactionTtl;
        }

        public void setTransactionTtl(Duration transactionTtl) {
            this.transactionTtl = transactionTtl;
        }

        public List<Surface> getSurfaces() {
            return surfaces;
        }

        public void setSurfaces(List<Surface> surfaces) {
            this.surfaces = surfaces == null ? new ArrayList<>() : surfaces;
        }

        public List<String> getApiAllowlist() {
            return apiAllowlist;
        }

        public void setApiAllowlist(List<String> apiAllowlist) {
            this.apiAllowlist = apiAllowlist == null ? new ArrayList<>() : apiAllowlist;
        }

        public List<String> getPublicApiAllowlist() {
            return publicApiAllowlist;
        }

        public void setPublicApiAllowlist(List<String> publicApiAllowlist) {
            this.publicApiAllowlist = publicApiAllowlist == null ? new ArrayList<>() : publicApiAllowlist;
        }
    }

    /**
     * One browser surface in the registry. {@code mode}: BFF (full BFF lane),
     * REDIRECT (apex → target host), NONE (no session, legacy/public).
     * {@code hosts} are the exact Host header values (with port) this
     * deployment binds to — production and preview each configure their own.
     */
    public static class Surface {
        private String id;
        private String mode = "BFF";
        private String clientId;
        private String clientSecret;
        private String proxySecret = "";
        /**
         * Public scheme://host[:port] base for this surface — drives the
         * registered client's exact callback/logout URIs.
         */
        private String publicBaseUrl = "";
        private List<String> hosts = new ArrayList<>();
        private String redirectTarget;
        private List<String> returnPrefixes = new ArrayList<>();

        public String getId() {
            return id;
        }

        public void setId(String id) {
            this.id = id;
        }

        public String getMode() {
            return mode;
        }

        public void setMode(String mode) {
            this.mode = mode;
        }

        public String getClientId() {
            return clientId;
        }

        public void setClientId(String clientId) {
            this.clientId = clientId;
        }

        public String getClientSecret() {
            return clientSecret;
        }

        public void setClientSecret(String clientSecret) {
            this.clientSecret = clientSecret;
        }

        public String getProxySecret() {
            return proxySecret;
        }

        public void setProxySecret(String proxySecret) {
            this.proxySecret = proxySecret == null ? "" : proxySecret;
        }

        public String getPublicBaseUrl() {
            return publicBaseUrl;
        }

        public void setPublicBaseUrl(String publicBaseUrl) {
            this.publicBaseUrl = publicBaseUrl == null ? "" : publicBaseUrl;
        }

        public List<String> getHosts() {
            return hosts;
        }

        public void setHosts(List<String> hosts) {
            this.hosts = hosts == null ? new ArrayList<>() : hosts;
        }

        public String getRedirectTarget() {
            return redirectTarget;
        }

        public void setRedirectTarget(String redirectTarget) {
            this.redirectTarget = redirectTarget;
        }

        public List<String> getReturnPrefixes() {
            return returnPrefixes;
        }

        public void setReturnPrefixes(List<String> returnPrefixes) {
            this.returnPrefixes = returnPrefixes == null ? new ArrayList<>() : returnPrefixes;
        }
    }

    /** Bounded cleanup for expired grants and aged logout audit rows. */
    public static class Retention {
        private boolean enabled = true;
        private String cron = "0 39 4 * * *";
        private Duration grace = Duration.ofDays(7);

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public String getCron() {
            return cron;
        }

        public void setCron(String cron) {
            this.cron = cron;
        }

        public Duration getGrace() {
            return grace;
        }

        public void setGrace(Duration grace) {
            this.grace = grace;
        }
    }
}
