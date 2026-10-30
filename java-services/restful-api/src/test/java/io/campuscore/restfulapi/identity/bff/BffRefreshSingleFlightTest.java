package io.campuscore.restfulapi.identity.bff;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

import io.campuscore.restfulapi.auth.repository.AuthUserRepository;
import io.campuscore.restfulapi.identity.IdentityProperties;
import java.time.Instant;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.server.authorization.OAuth2Authorization;

class BffRefreshSingleFlightTest {
    private final BffSessionStore store = mock(BffSessionStore.class);
    private final BffTokenClient tokens = mock(BffTokenClient.class);
    private final AuthUserRepository users = mock(AuthUserRepository.class);
    private final org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationService grants =
            mock(org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationService.class);
    private final IdentityProperties.Surface surface = new IdentityProperties.Surface();
    private BffSessionService service;

    @BeforeEach
    void setUp() {
        surface.setId("portal");
        surface.setClientId("portal-client");
        service = new BffSessionService(new IdentityProperties(), store, tokens, null,
                grants, users, null, null);
        when(store.findSession(anyString(), anyString())).thenAnswer(invocation ->
                new BffSessionStore.Session(invocation.getArgument(0), "user", invocation.getArgument(1),
                        "portal-client", "grant", null, Instant.now().plusSeconds(3600), null));
        when(users.findAccountAuthorization("user")).thenReturn(Optional.of(
                new AuthUserRepository.AccountAuthorization("ACTIVE", false, null, null, null,
                        Set.of(), Set.of(), 0)));
        // Every new request observes expiry (including expiry after a previous rotation).
        when(grants.findById("grant")).thenReturn(grant(true));
        when(grants.findByToken(anyString(), any())).thenReturn(grant(false));
        when(tokens.refresh(any(), anyString())).thenReturn(response());
    }

    @Test
    void threeOverlappingCallersKeepOneActiveRefreshAfterFirstOwnerExits() throws Exception {
        var firstInRefresh = new CountDownLatch(1);
        var releaseFirst = new CountDownLatch(1);
        var secondInRefresh = new CountDownLatch(1);
        var releaseSecond = new CountDownLatch(1);
        var thirdInRefresh = new CountDownLatch(1);
        var calls = new AtomicInteger();
        var active = new AtomicInteger();
        var maximum = new AtomicInteger();
        when(tokens.refresh(any(), anyString())).thenAnswer(invocation -> {
            maximum.accumulateAndGet(active.incrementAndGet(), Math::max);
            try {
                switch (calls.incrementAndGet()) {
                    case 1 -> { firstInRefresh.countDown(); await(releaseFirst); }
                    case 2 -> { secondInRefresh.countDown(); await(releaseSecond); }
                    default -> thirdInRefresh.countDown();
                }
                return response();
            } finally { active.decrementAndGet(); }
        });
        var pool = Executors.newFixedThreadPool(3);
        var secondThread = new AtomicReference<Thread>();
        var thirdThread = new AtomicReference<Thread>();
        try {
            var first = pool.submit(() -> service.resolveForBusiness(surface, "same-session"));
            await(firstInRefresh);
            var second = pool.submit(() -> {
                secondThread.set(Thread.currentThread());
                return service.resolveForBusiness(surface, "same-session");
            });
            until(() -> blocked(secondThread));
            releaseFirst.countDown();
            assertThat(first.get(10, TimeUnit.SECONDS).ok()).isTrue();
            await(secondInRefresh);
            var third = pool.submit(() -> {
                thirdThread.set(Thread.currentThread());
                return service.resolveForBusiness(surface, "same-session");
            });
            // Old code admits C on a new monitor while B holds the original.
            // Correct code leaves C blocked until B finishes its refresh.
            until(() -> blocked(thirdThread) || thirdInRefresh.getCount() == 0);
            releaseSecond.countDown();
            assertThat(second.get(10, TimeUnit.SECONDS).ok()).isTrue();
            assertThat(third.get(10, TimeUnit.SECONDS).ok()).isTrue();
            assertThat(calls.get()).isEqualTo(3);
            assertThat(maximum.get()).as("one active refresh for the same session").isEqualTo(1);
        } finally {
            releaseFirst.countDown();
            releaseSecond.countDown();
            pool.shutdownNow();
            assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void independentSessionsCanRefreshWhileAnotherSessionIsWaiting() throws Exception {
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var owner = new AtomicReference<Thread>();
        when(tokens.refresh(any(), anyString())).thenAnswer(invocation -> {
            if (Thread.currentThread() == owner.get()) { entered.countDown(); await(release); }
            return response();
        });
        var pool = Executors.newFixedThreadPool(2);
        try {
            var first = pool.submit(() -> {
                owner.set(Thread.currentThread());
                return service.resolveForBusiness(surface, "session-a");
            });
            await(entered);
            var independent = pool.submit(() -> service.resolveForBusiness(surface, "session-b"));
            assertThat(independent.get(10, TimeUnit.SECONDS).ok()).isTrue();
            release.countDown();
            assertThat(first.get(10, TimeUnit.SECONDS).ok()).isTrue();
        } finally {
            release.countDown(); pool.shutdownNow();
            assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void refreshFailureReleasesGuardForNextCaller() throws Exception {
        when(tokens.refresh(any(), anyString())).thenThrow(new IllegalStateException("synthetic failure"))
                .thenReturn(response());
        assertThat(service.resolveForBusiness(surface, "session").ok()).isFalse();
        var pool = Executors.newSingleThreadExecutor();
        try {
            assertThat(pool.submit(() -> service.resolveForBusiness(surface, "session"))
                    .get(10, TimeUnit.SECONDS).ok()).isTrue();
        } finally { pool.shutdownNow(); assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue(); }
    }

    @Test
    void revokeCommittedDuringRefreshFailsClosed() {
        when(tokens.refresh(any(), anyString())).thenAnswer(invocation -> {
            when(store.findSession("session", "portal")).thenReturn(null);
            return response();
        });
        var result = service.resolveForBusiness(surface, "session");
        assertThat(result.ok()).isFalse();
        assertThat(result.failure()).isEqualTo("SESSION_REQUIRED");
        verify(store, never()).touch(anyString());
    }

    @Test
    void sessionLookupKeepsSurfaceBoundary() {
        when(store.findSession("foreign", "portal")).thenReturn(null);
        assertThat(service.resolveForBusiness(surface, "foreign").ok()).isFalse();
        verify(tokens, never()).refresh(any(), anyString());
    }

    private static boolean blocked(AtomicReference<Thread> thread) {
        Thread caller = thread.get();
        if (caller == null || caller.getState() != Thread.State.BLOCKED) return false;
        StackTraceElement[] stack = caller.getStackTrace();
        return stack.length > 0 && stack[0].getClassName().equals(BffSessionService.class.getName())
                && stack[0].getMethodName().equals("resolveForBusiness");
    }

    private static void until(BooleanSupplier condition) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (!condition.getAsBoolean() && System.nanoTime() < deadline) Thread.sleep(1);
        assertThat(condition.getAsBoolean()).as("scheduled caller reached the guard or refresh").isTrue();
    }

    private static void await(CountDownLatch latch) throws InterruptedException {
        assertThat(latch.await(10, TimeUnit.SECONDS)).as("refresh schedule barrier").isTrue();
    }

    private static BffTokenClient.TokenResponse response() {
        return new BffTokenClient.TokenResponse("synthetic-access", "synthetic-refresh", null, "grant", 300);
    }

    private static OAuth2Authorization grant(boolean expired) {
        Instant now = Instant.now();
        var client = org.springframework.security.oauth2.server.authorization.client.RegisteredClient
                .withId("client").clientId("portal-client")
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri("https://example.invalid/callback").build();
        return OAuth2Authorization.withRegisteredClient(client).id("grant").principalName("user")
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .accessToken(new OAuth2AccessToken(OAuth2AccessToken.TokenType.BEARER, "synthetic-access",
                        now.minusSeconds(600), expired ? now.minusSeconds(60) : now.plusSeconds(600)))
                .refreshToken(new OAuth2RefreshToken("synthetic-refresh", now.minusSeconds(600), now.plusSeconds(3600)))
                .build();
    }
}
