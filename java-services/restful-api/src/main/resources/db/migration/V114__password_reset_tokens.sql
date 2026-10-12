-- V114: self-service password reset via emailed one-time links.
--
-- "PasswordResetToken" stores only the SHA-256 hex of each issued token, so a
-- database read never yields a usable credential. Identifier style mirrors
-- campuscore_auth."User" (VARCHAR(120) ids, quoted camelCase columns);
-- instants use TIMESTAMP WITH TIME ZONE like TwoFactorChallenge (V85).
-- No GRANT is issued: campuscore_assistant_runtime receives access only via
-- explicit per-table grants, so it can never read this table.

CREATE TABLE IF NOT EXISTS campuscore_auth."PasswordResetToken" (
    "id" VARCHAR(120) PRIMARY KEY,
    "userId" VARCHAR(120) NOT NULL REFERENCES campuscore_auth."User" ("id") ON DELETE CASCADE,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "usedAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestIp" VARCHAR(64),
    CONSTRAINT campuscore_auth_password_reset_token_hash_key UNIQUE ("tokenHash")
);

CREATE INDEX IF NOT EXISTS campuscore_auth_password_reset_token_user_idx
    ON campuscore_auth."PasswordResetToken" ("userId");

CREATE INDEX IF NOT EXISTS campuscore_auth_password_reset_token_expiry_idx
    ON campuscore_auth."PasswordResetToken" ("expiresAt");
