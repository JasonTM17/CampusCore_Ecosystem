package io.campuscore.restfulapi.notification.push;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** Runtime switches and bounded delivery policy for the additive push lane. */
@Component
@ConfigurationProperties(prefix = "app.notifications.push")
public class PushProperties {

    private boolean enabled;
    private String tokenKey = "";
    private boolean dispatcherEnabled;
    private int batchSize = 25;
    private long leaseSeconds = 60;
    private int maxAttempts = 5;
    private long retryInitialMs = 1_000;
    private long retryCapMs = 300_000;
    private double retryJitterRatio = 0.2;

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public String getTokenKey() { return tokenKey; }
    public void setTokenKey(String tokenKey) { this.tokenKey = tokenKey == null ? "" : tokenKey; }
    public boolean isDispatcherEnabled() { return dispatcherEnabled; }
    public void setDispatcherEnabled(boolean dispatcherEnabled) { this.dispatcherEnabled = dispatcherEnabled; }
    public int getBatchSize() { return batchSize; }
    public void setBatchSize(int batchSize) { this.batchSize = batchSize; }
    public long getLeaseSeconds() { return leaseSeconds; }
    public void setLeaseSeconds(long leaseSeconds) { this.leaseSeconds = leaseSeconds; }
    public int getMaxAttempts() { return maxAttempts; }
    public void setMaxAttempts(int maxAttempts) { this.maxAttempts = maxAttempts; }
    public long getRetryInitialMs() { return retryInitialMs; }
    public void setRetryInitialMs(long retryInitialMs) { this.retryInitialMs = retryInitialMs; }
    public long getRetryCapMs() { return retryCapMs; }
    public void setRetryCapMs(long retryCapMs) { this.retryCapMs = retryCapMs; }
    public double getRetryJitterRatio() { return retryJitterRatio; }
    public void setRetryJitterRatio(double retryJitterRatio) { this.retryJitterRatio = retryJitterRatio; }
}
