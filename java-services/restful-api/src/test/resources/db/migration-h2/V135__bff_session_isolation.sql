-- H2 mirror of V135__bff_session_isolation.sql (Postgres).
-- Same logical schema so MockMvc contract tests exercise the real DDL.

CREATE TABLE IF NOT EXISTS campuscore_identity.bff_session (
    id varchar(64) NOT NULL,                 -- sha256(opaque cookie value)
    user_id varchar(120) NOT NULL,
    surface varchar(24) NOT NULL,
    client_id varchar(255) NOT NULL,         -- denormalized: client-scoped sweeps
    authorization_id varchar(255) NOT NULL,
    csrf_ciphertext varchar(512) NOT NULL,   -- AES-GCM (recoverable for state endpoint)
    ip varchar(45),
    user_agent varchar(300),
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp NOT NULL,
    revoked_at timestamp,
    PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS campuscore_identity_bff_session_user_idx
    ON campuscore_identity.bff_session (user_id);
CREATE INDEX IF NOT EXISTS campuscore_identity_bff_session_client_idx
    ON campuscore_identity.bff_session (user_id, client_id);
CREATE INDEX IF NOT EXISTS campuscore_identity_bff_session_authz_idx
    ON campuscore_identity.bff_session (authorization_id);
CREATE INDEX IF NOT EXISTS campuscore_identity_bff_session_expiry_idx
    ON campuscore_identity.bff_session (expires_at);

CREATE TABLE IF NOT EXISTS campuscore_identity.bff_transaction (
    state_hash varchar(64) NOT NULL,
    tx_id varchar(32) NOT NULL,
    surface varchar(24) NOT NULL,
    nonce varchar(64) NOT NULL,
    verifier varchar(512) NOT NULL,
    return_path varchar(300) NOT NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp NOT NULL,
    PRIMARY KEY (state_hash)
);

CREATE INDEX IF NOT EXISTS campuscore_identity_bff_tx_expiry_idx
    ON campuscore_identity.bff_transaction (expires_at);
