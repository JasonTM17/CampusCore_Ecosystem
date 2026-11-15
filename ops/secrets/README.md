# Runtime secrets (local stack)

The local stack reads secrets from the gitignored `.env`, created from
`.env.example` ([README.md](../../README.md#quick-start-local)); `node
scripts/local-dev.mjs up` creates it when absent. Nothing in this repository
mounts secret files, and no committed file may hold a real value. Values stay in
the services that need them — PostgreSQL, the API, the RAG sidecar and the
assistant provisioner; the web container receives build-time public values only.

Rotate before first use. `JWT_SECRET` and `JWT_REFRESH_SECRET` ship known
placeholders, and `SECURITY_JWT_REJECT_KNOWN_DEFAULTS=true` makes a release-like
run refuse to start on them. That refusal is the intended fail-closed behavior,
not a setup bug. `HEALTH_READINESS_KEY` also ships the known placeholder
`local-course-health-key`, but that flag does not cover it: rotate the readiness
key separately and never deploy the template value.

- Generate values with `openssl rand -base64 48` (or another cryptographically
  secure generator) and keep them in `.env` only.
- Use a newly rotated provider key. A key pasted into a chat, ticket, shell
  history, image, or Git repository is considered compromised and must not be
  reused.
- Never pass a secret to the web container or commit a populated `.env`.

For local Compose, `ASSISTANT_DB_PROVISIONER_PASSWORD` is a separate generated
secret for the `campuscore_assistant_provisioner` login. PostgreSQL reads it
only during owner bootstrap, and the one-shot provisioner uses it instead of
the database bootstrap credential. It is distinct from
`ASSISTANT_DB_PASSWORD`, which is the Assistant runtime password.

## Production Compose secret files

`docker-compose.prod.yml` mounts the set below at `/run/secrets/<name>`.
Create each file next to this README on the deploy host (never commit real
values). One exception: `ASSISTANT_DB_PROVISIONER_PASSWORD` travels as a
Compose environment variable, not a file, because the initdb bootstrap
(`ops/assistant/bootstrap-provisioner.sql`) reads it via `\getenv`.

- `postgres_password`
- `jwt_secret`
- `jwt_refresh_secret`
- `readiness_key`
- `rag_service_token`
- `supabase_service_role_key` (required when `ASSISTANT_SUPABASE_ENABLED=true`)
- `deepseek_api_key` (required only when `DEEPSEEK_ENABLED=true`)
- `assistant_db_password` — password for the `campuscore_assistant_runtime`
  database role; the Assistant API returns `503 ASSISTANT_RLS_UNAVAILABLE`
  without it. The value must exist and be non-blank.
- `assistant_db_provisioner_password` — separate credential for the restricted
  one-shot Assistant provisioner login; never use the database administrator
  password for this secret.
- `spring_mail_password` — SMTP password for `SPRING_MAIL_USERNAME`; only
  read when `MAIL_ENABLED=true`, so a placeholder is acceptable while mail
  stays disabled.
