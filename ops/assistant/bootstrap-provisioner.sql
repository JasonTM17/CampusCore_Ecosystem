\set ON_ERROR_STOP on
\getenv provisioner_password ASSISTANT_DB_PROVISIONER_PASSWORD
\if :{?provisioner_password}
\else
\echo 'ASSISTANT_DB_PROVISIONER_PASSWORD is required'
\quit 3
\endif

SELECT CASE
    WHEN pg_catalog.char_length(:'provisioner_password') >= 16
         AND pg_catalog.btrim(:'provisioner_password') <> '' THEN 1
    ELSE 1 / 0
END AS provisioner_password_valid;

BEGIN;

DO $bootstrap$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'postgres') THEN
        CREATE ROLE postgres
            NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
            NOREPLICATION NOBYPASSRLS;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'campuscore_assistant_runtime'
    ) THEN
        CREATE ROLE campuscore_assistant_runtime
            NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
            NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 8;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_roles
         WHERE rolname = 'campuscore_assistant_runtime'
           AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication
                OR rolbypassrls OR rolconnlimit <> 8)
    ) THEN
        RAISE EXCEPTION 'campuscore_assistant_runtime has unsafe role attributes';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_auth_members m
          JOIN pg_catalog.pg_roles r ON r.oid = m.member OR r.oid = m.roleid
         WHERE r.rolname = 'campuscore_assistant_runtime'
    ) THEN
        RAISE EXCEPTION 'campuscore_assistant_runtime must have no role memberships';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'campuscore_assistant_provisioner_owner'
    ) THEN
        CREATE ROLE campuscore_assistant_provisioner_owner
            NOLOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOINHERIT
            NOREPLICATION NOBYPASSRLS;
    END IF;
    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_roles
         WHERE rolname = 'campuscore_assistant_provisioner_owner'
           AND (rolcanlogin OR rolsuper OR rolcreatedb OR NOT rolcreaterole
                OR rolinherit OR rolreplication OR rolbypassrls)
    ) THEN
        RAISE EXCEPTION 'assistant provisioner function owner has unsafe role attributes';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_auth_members m
          JOIN pg_catalog.pg_roles r ON r.oid = m.member OR r.oid = m.roleid
         WHERE r.rolname = 'campuscore_assistant_provisioner_owner'
    ) THEN
        RAISE EXCEPTION 'assistant provisioner function owner must have no role memberships';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'campuscore_assistant_provisioner'
    ) THEN
        CREATE ROLE campuscore_assistant_provisioner
            LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
            NOREPLICATION NOBYPASSRLS;
    END IF;
    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_roles
         WHERE rolname = 'campuscore_assistant_provisioner'
           AND (NOT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole
                OR rolinherit OR rolreplication OR rolbypassrls)
    ) THEN
        RAISE EXCEPTION 'assistant provisioner login has unsafe role attributes';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_auth_members m
          JOIN pg_catalog.pg_roles r ON r.oid = m.member OR r.oid = m.roleid
         WHERE r.rolname = 'campuscore_assistant_provisioner'
    ) THEN
        RAISE EXCEPTION 'assistant provisioner login must have no role memberships';
    END IF;
END
$bootstrap$;

ALTER ROLE campuscore_assistant_provisioner PASSWORD :'provisioner_password';

DO $schema$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'assistant_ops'
    ) THEN
        CREATE SCHEMA assistant_ops AUTHORIZATION campuscore_assistant_provisioner_owner;
    ELSE
        ALTER SCHEMA assistant_ops OWNER TO campuscore_assistant_provisioner_owner;
    END IF;
END
$schema$;

REVOKE ALL ON SCHEMA assistant_ops FROM PUBLIC;
REVOKE ALL ON SCHEMA assistant_ops FROM campuscore_assistant_provisioner;

CREATE OR REPLACE FUNCTION assistant_ops.set_runtime_password(p_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
    runtime_role_oid oid;
BEGIN
    IF p_password IS NULL OR pg_catalog.btrim(p_password) = ''
       OR pg_catalog.char_length(p_password) < 16 THEN
        RAISE EXCEPTION 'runtime password must be at least 16 nonblank characters'
            USING ERRCODE = '22023';
    END IF;

    SELECT r.oid
      INTO runtime_role_oid
      FROM pg_catalog.pg_roles r
     WHERE r.rolname = 'campuscore_assistant_runtime'
       AND NOT r.rolsuper
       AND NOT r.rolcreatedb
       AND NOT r.rolcreaterole
       AND NOT r.rolinherit
       AND NOT r.rolreplication
       AND NOT r.rolbypassrls
       AND r.rolconnlimit = 8;
    IF runtime_role_oid IS NULL THEN
        RAISE EXCEPTION 'campuscore_assistant_runtime is missing or has unsafe role attributes'
            USING ERRCODE = '55000';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_auth_members m
         WHERE m.roleid = runtime_role_oid OR m.member = runtime_role_oid
    ) THEN
        RAISE EXCEPTION 'campuscore_assistant_runtime must have no role memberships'
            USING ERRCODE = '55000';
    END IF;

    EXECUTE pg_catalog.format(
        'ALTER ROLE campuscore_assistant_runtime WITH LOGIN PASSWORD %L',
        p_password);
END
$function$;

ALTER FUNCTION assistant_ops.set_runtime_password(text)
    OWNER TO campuscore_assistant_provisioner_owner;
REVOKE EXECUTE ON FUNCTION assistant_ops.set_runtime_password(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION assistant_ops.set_runtime_password(text)
    FROM campuscore_assistant_provisioner;
GRANT USAGE ON SCHEMA assistant_ops TO campuscore_assistant_provisioner;
GRANT EXECUTE ON FUNCTION assistant_ops.set_runtime_password(text)
    TO campuscore_assistant_provisioner;

DO $database_grants$
BEGIN
    -- Remove direct grants but preserve PostgreSQL's PUBLIC CONNECT and TEMPORARY defaults.
    EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON DATABASE %I FROM campuscore_assistant_provisioner',
        pg_catalog.current_database());
    EXECUTE pg_catalog.format(
        'GRANT CONNECT ON DATABASE %I TO campuscore_assistant_provisioner',
        pg_catalog.current_database());
END
$database_grants$;

COMMIT;
