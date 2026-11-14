# Assistant database provisioner

`bootstrap-provisioner.sql` is an owner-only PostgreSQL 15 bootstrap, not a
Flyway migration. On a new Compose volume, PostgreSQL runs it during database
initialization before the provisioner or any Flyway service starts. It creates
the `postgres` compatibility shim when missing, the `NOLOGIN` runtime role,
the isolated function owner, the restricted provisioner login, and the
`assistant_ops.set_runtime_password(text)` function.

## Existing or manually managed databases

Set `ASSISTANT_DB_PROVISIONER_PASSWORD` to a generated value of at least 16
characters in the owner session, then run the SQL as the database owner. The
SQL reads the password from the process environment and quotes it through
psql's literal interpolation:

```powershell
$env:ASSISTANT_DB_PROVISIONER_PASSWORD = "<generated restricted-login password>"
psql --no-psqlrc --set ON_ERROR_STOP=1 --username $env:POSTGRES_USER --dbname $env:POSTGRES_DB --file ops/assistant/bootstrap-provisioner.sql
```

To provision the runtime role before Flyway starts, provide the same
restricted-login password and the desired runtime password. The script uses
the JDBC URL only as a connection target; it ignores the main datasource user
and password:

```powershell
$env:SPRING_DATASOURCE_URL = "jdbc:postgresql://localhost:5432/campuscore_restful"
$env:ASSISTANT_DB_PROVISIONER_PASSWORD = "<same restricted-login password>"
$env:ASSISTANT_DB_PASSWORD = "<generated runtime password of at least 16 characters>"
node scripts/provision-assistant-runtime.mjs
```

PostgreSQL 15 grants `CONNECT` and `TEMPORARY` on a database to `PUBLIC` by default. The provisioner
keeps effective `CONNECT` (also granted directly) and `TEMPORARY` through `PUBLIC`; temporary tables
are session-local and expose no other role's data, so this low residual capability is accepted. To
tighten this later, the database owner can use a database-wide revoke,
`REVOKE CONNECT, TEMPORARY ON DATABASE <database> FROM PUBLIC;`, then explicitly grant `CONNECT`
and/or `TEMPORARY` on the database to roles that need them. Roles relying on `PUBLIC` for either
privilege would lose the corresponding ability to open new connections and/or create temporary
tables until granted directly.

## Disable or roll back provisioning

Run these statements as the database owner to disable the one-shot operation:

```sql
REVOKE EXECUTE ON FUNCTION assistant_ops.set_runtime_password(text)
    FROM campuscore_assistant_provisioner;
ALTER ROLE campuscore_assistant_provisioner NOLOGIN;
```

To restore the operation later, the owner can rerun the bootstrap SQL with a
new restricted-login password. Do not put `POSTGRES_PASSWORD` or another
administrator credential back into the provisioner container.

Hosted and Supabase privilege compatibility has not been verified; this
bootstrap is scoped to owner-controlled PostgreSQL 15 initialization.
