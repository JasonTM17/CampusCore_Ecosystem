# systemd backup units (deferred)

These units are a **future always-on host** artifact. No unit is installed by
the local-first workflow, and today's executed recovery path is the disposable
drill in [../backup/README.md](../backup/README.md).

If an owned, always-on host target is ever approved, copy the service and timer
to `/etc/systemd/system/` only after adjusting `WorkingDirectory` and the
running user, then run:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now campuscore-backup.timer
systemctl list-timers campuscore-backup.timer
```

Off-site replication is intentionally not enabled until an approved object
storage target and retention policy exist.
