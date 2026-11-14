# One-off SQL scripts (no runtime authority)

The `.sql` files in this directory are historical prototypes, demo seeds, and
repair scripts from early iterations (V43-era schema). They have **zero
runtime authority**:

- All valid DDL and data adjustments are already codified in permanent Flyway
  migrations under `java-services/restful-api/src/main/resources/db/migration/`.
- Each script is guarded behind `SET campuscore.demo_seed = 'on';` and will
  abort without the explicit opt-in.
- They may lag the current schema and must **never** be applied to any live
  database.

See `docs/integrations/flyway-lineage.md` (§1.3) for the full boundary.
