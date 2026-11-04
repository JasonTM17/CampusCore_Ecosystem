-- Remove the retired Render warm-ping job from projects that still have it.
--
-- The Render host is retired, so the job only produces dead-host traffic.
-- Safe everywhere: no-op without pg_cron, without the job, and on re-runs.
DO $$
BEGIN
    IF to_regnamespace('cron') IS NULL
       OR to_regprocedure('cron.unschedule(text)') IS NULL
       OR to_regclass('cron.job') IS NULL THEN
        RAISE NOTICE 'pg_cron not installed; render warm ping unschedule skipped';
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM cron.job WHERE jobname = 'render_keepalive_warm_ping'
    ) THEN
        RAISE NOTICE 'render warm ping job not present; nothing to unschedule';
        RETURN;
    END IF;

    BEGIN
        PERFORM cron.unschedule('render_keepalive_warm_ping');
    EXCEPTION WHEN OTHERS THEN
        -- Only a job that vanished between the check and the call counts as
        -- clean; any other failure (for example missing privileges) must fail
        -- the migration instead of leaving the schedule running.
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'render_keepalive_warm_ping') THEN
            RAISE;
        END IF;
        RAISE NOTICE 'render warm ping job already removed';
    END;
END
$$;
