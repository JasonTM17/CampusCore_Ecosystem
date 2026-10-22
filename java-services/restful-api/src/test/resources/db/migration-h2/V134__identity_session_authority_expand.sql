-- H2 mirror of V134__identity_session_authority_expand.sql (Postgres).
-- Same logical schema so MockMvc contract tests exercise the real DDL.

ALTER TABLE campuscore_auth."Session"
    ADD COLUMN IF NOT EXISTS "lane" VARCHAR(16) NOT NULL DEFAULT 'LEGACY';
ALTER TABLE campuscore_auth."Session"
    ADD COLUMN IF NOT EXISTS "clientId" VARCHAR(80);
ALTER TABLE campuscore_auth."Session"
    ADD COLUMN IF NOT EXISTS "authorizationId" VARCHAR(120);
ALTER TABLE campuscore_auth."Session"
    ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP;
ALTER TABLE campuscore_auth."Session"
    ADD COLUMN IF NOT EXISTS "rotatedAt" TIMESTAMP;

ALTER TABLE campuscore_auth."Session"
    DROP CONSTRAINT IF EXISTS campuscore_auth_session_lane_check;
ALTER TABLE campuscore_auth."Session"
    ADD CONSTRAINT campuscore_auth_session_lane_check
    CHECK ("lane" IN ('LEGACY', 'OIDC', 'BFF'));

CREATE INDEX IF NOT EXISTS campuscore_auth_session_authorization_idx
    ON campuscore_auth."Session" ("authorizationId");

CREATE SCHEMA IF NOT EXISTS campuscore_identity;

CREATE TABLE IF NOT EXISTS campuscore_identity.oauth2_authorization (
    id varchar(255) NOT NULL,
    registered_client_id varchar(255) NOT NULL,
    principal_name varchar(200) NOT NULL,
    authorization_grant_type varchar(100) NOT NULL,
    authorized_scopes varchar(1000) DEFAULT NULL,
    attributes TEXT DEFAULT NULL,
    state varchar(500) DEFAULT NULL,
    authorization_code_value TEXT DEFAULT NULL,
    authorization_code_issued_at timestamp DEFAULT NULL,
    authorization_code_expires_at timestamp DEFAULT NULL,
    authorization_code_metadata TEXT DEFAULT NULL,
    access_token_value TEXT DEFAULT NULL,
    access_token_issued_at timestamp DEFAULT NULL,
    access_token_expires_at timestamp DEFAULT NULL,
    access_token_metadata TEXT DEFAULT NULL,
    access_token_type varchar(100) DEFAULT NULL,
    access_token_scopes varchar(1000) DEFAULT NULL,
    oidc_id_token_value TEXT DEFAULT NULL,
    oidc_id_token_issued_at timestamp DEFAULT NULL,
    oidc_id_token_expires_at timestamp DEFAULT NULL,
    oidc_id_token_metadata TEXT DEFAULT NULL,
    refresh_token_value TEXT DEFAULT NULL,
    refresh_token_issued_at timestamp DEFAULT NULL,
    refresh_token_expires_at timestamp DEFAULT NULL,
    refresh_token_metadata TEXT DEFAULT NULL,
    user_code_value TEXT DEFAULT NULL,
    user_code_issued_at timestamp DEFAULT NULL,
    user_code_expires_at timestamp DEFAULT NULL,
    user_code_metadata TEXT DEFAULT NULL,
    device_code_value TEXT DEFAULT NULL,
    device_code_issued_at timestamp DEFAULT NULL,
    device_code_expires_at timestamp DEFAULT NULL,
    device_code_metadata TEXT DEFAULT NULL,
    PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS campuscore_identity_authz_principal_idx
    ON campuscore_identity.oauth2_authorization (principal_name);

CREATE TABLE IF NOT EXISTS campuscore_identity.oauth2_authorization_consent (
    registered_client_id varchar(255) NOT NULL,
    principal_name varchar(200) NOT NULL,
    authorities varchar(1000) NOT NULL,
    PRIMARY KEY (registered_client_id, principal_name)
);

CREATE TABLE IF NOT EXISTS campuscore_identity.oidc_refresh_lineage (
    token_hash varchar(64) NOT NULL,
    authorization_id varchar(255) NOT NULL,
    user_id varchar(120) NOT NULL,
    state varchar(8) NOT NULL DEFAULT 'LIVE',
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    used_at timestamp,
    PRIMARY KEY (token_hash)
);

CREATE INDEX IF NOT EXISTS campuscore_identity_refresh_lineage_authz_idx
    ON campuscore_identity.oidc_refresh_lineage (authorization_id);

CREATE TABLE IF NOT EXISTS campuscore_identity.logout_audit (
    id varchar(64) NOT NULL,
    user_id varchar(120) NOT NULL,
    lane varchar(16) NOT NULL,
    reason varchar(60) NOT NULL,
    request_id varchar(128),
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS campuscore_identity_logout_audit_user_idx
    ON campuscore_identity.logout_audit (user_id);
