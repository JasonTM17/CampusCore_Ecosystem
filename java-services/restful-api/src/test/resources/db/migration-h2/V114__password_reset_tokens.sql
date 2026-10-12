-- H2 twin of production V114 (see src/main/resources/db/migration/V114__password_reset_tokens.sql):
-- self-service password reset via emailed one-time links.

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
