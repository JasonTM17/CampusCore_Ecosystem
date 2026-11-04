-- Supabase twin of V77__align_demo_account_passwords.sql.
--
-- Demo-only: this migration rewrites credentials and lockout state, so it must
-- only run when the operator opts in for the session, exactly like the
-- database/ one-off scripts:
--     SET campuscore.demo_seed = 'on';
-- Without the opt-in it is a no-op, as it is when the application auth table is
-- absent from the target project.
DO $$
BEGIN
    IF current_setting('campuscore.demo_seed', true) IS DISTINCT FROM 'on' THEN
        RAISE NOTICE 'align_demo_account_passwords is demo-only: run SET campuscore.demo_seed = ''on''; in this session to opt in';
        RETURN;
    END IF;

    IF to_regclass('campuscore_auth."User"') IS NULL THEN
        RAISE NOTICE 'campuscore_auth."User" is absent; align_demo_account_passwords skipped';
        RETURN;
    END IF;

    UPDATE campuscore_auth."User"
    SET "password" = '$2a$10$raV9MB3Qmj1Rbu2Rmo1vNup7VsC2OM3AqmcTcTLzbNyMyI4r2rJBe',
        "failedLoginAttempts" = 0,
        "lockedUntil" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "email" IN (
        'admin@campuscore.edu',
        'admin002@campuscore.demo',
        'lecturer002@campuscore.demo',
        'lecturer003@campuscore.demo',
        'lecturer004@campuscore.demo',
        'lecturer005@campuscore.demo',
        'lecturer006@campuscore.demo',
        'lecturer007@campuscore.demo',
        'lecturer008@campuscore.demo',
        'lecturer009@campuscore.demo',
        'lecturer010@campuscore.demo',
        'lecturer011@campuscore.demo',
        'lecturer012@campuscore.demo'
    );
END
$$;
