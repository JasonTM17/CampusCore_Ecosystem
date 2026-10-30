-- H2 mirror of V143__notification_push_delivery.sql.
-- H2 fixture mode omits the User foreign key and uses a full ready index
-- instead of the PostgreSQL partial index; send-time checks stay in Java.
CREATE SCHEMA IF NOT EXISTS notifications;

CREATE TABLE IF NOT EXISTS notifications.device_registration (
    id VARCHAR(120) PRIMARY KEY,
    user_id VARCHAR(120) NOT NULL,
    installation_id VARCHAR(200) NOT NULL,
    provider VARCHAR(40) NOT NULL,
    platform VARCHAR(40) NOT NULL,
    token_ciphertext CLOB NOT NULL,
    token_fingerprint CHAR(64) NOT NULL,
    credential_version BIGINT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'REVOKED')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT device_registration_provider_fingerprint_unique
        UNIQUE (provider, token_fingerprint),
    CONSTRAINT device_registration_user_installation_unique
        UNIQUE (user_id, installation_id)
);

CREATE INDEX IF NOT EXISTS device_registration_user_status_idx
    ON notifications.device_registration (user_id, status);

CREATE TABLE IF NOT EXISTS notifications.delivery_outbox (
    id VARCHAR(120) PRIMARY KEY,
    notification_id VARCHAR(120) NOT NULL,
    device_id VARCHAR(120) NOT NULL,
    recipient_user_id VARCHAR(120) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'CLAIMED', 'RETRY_WAIT', 'SENT',
            'FAILED', 'SUPPRESSED', 'BLOCKED')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_error_code VARCHAR(48),
    lease_owner VARCHAR(120),
    lease_generation BIGINT NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
    lease_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT delivery_outbox_notification_device_unique
        UNIQUE (notification_id, device_id)
);

-- H2 uses a full index; the production claim path uses PostgreSQL row locking.
CREATE INDEX IF NOT EXISTS delivery_outbox_ready_idx
    ON notifications.delivery_outbox (status, next_attempt_at, created_at, id);
