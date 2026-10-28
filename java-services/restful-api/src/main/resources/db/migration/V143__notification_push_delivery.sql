-- Additive push registration and delivery outbox. Inbox notifications remain
-- the source of truth; provider delivery is only a signal to reopen the app.
CREATE SCHEMA IF NOT EXISTS notifications;

CREATE TABLE notifications.device_registration (
    id VARCHAR(120) PRIMARY KEY,
    user_id VARCHAR(120) NOT NULL REFERENCES campuscore_auth."User" ("id"),
    installation_id VARCHAR(200) NOT NULL,
    provider VARCHAR(40) NOT NULL,
    platform VARCHAR(40) NOT NULL,
    token_ciphertext TEXT NOT NULL,
    token_fingerprint CHAR(64) NOT NULL,
    credential_version BIGINT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'REVOKED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT device_registration_provider_fingerprint_unique
        UNIQUE (provider, token_fingerprint),
    CONSTRAINT device_registration_user_installation_unique
        UNIQUE (user_id, installation_id)
);

CREATE INDEX device_registration_user_status_idx
    ON notifications.device_registration (user_id, status);

CREATE TABLE notifications.delivery_outbox (
    id VARCHAR(120) PRIMARY KEY,
    notification_id VARCHAR(120) NOT NULL,
    device_id VARCHAR(120) NOT NULL,
    recipient_user_id VARCHAR(120) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'CLAIMED', 'RETRY_WAIT', 'SENT',
            'FAILED', 'SUPPRESSED', 'BLOCKED')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_error_code VARCHAR(48),
    lease_owner VARCHAR(120),
    lease_generation BIGINT NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
    lease_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMPTZ,
    CONSTRAINT delivery_outbox_notification_device_unique
        UNIQUE (notification_id, device_id)
);

CREATE INDEX delivery_outbox_ready_idx
    ON notifications.delivery_outbox (next_attempt_at, created_at, id)
    WHERE status IN ('PENDING', 'RETRY_WAIT', 'CLAIMED');
