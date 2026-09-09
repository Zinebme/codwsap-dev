# Existing WhatsApp template repair

Deploy the code, then run against the intended staging database with the existing
PostgreSQL environment configured (DATABASE_URL; MIGRATION_DATABASE_URL for the
migration session connection). Never point the regression suites at staging:
they create disposable local fixtures.

1. `npm run db:migrate` applies **0007_reclassify_template_groups.sql**.
   Migration 0006 remains unchanged. Known names take precedence over event keys;
   recognized legacy event keys classify custom names. Unrecognized custom
   templates retain their groups. Only template_group and group_key are updated.
2. `npm run templates:backfill` inserts missing starter variants for every merchant.
   To target one merchant: `npm run templates:backfill -- --merchant <merchantId>`.
   This command requires DATABASE_URL and does not submit anything to Meta.
   It reports merchants processed, rows created, already existing rows, per-language
   creation counts and errors. Any failure returns a nonzero exit code. Each
   merchant is transactional; retrying is safe. Existing rows are never updated.
3. Confirm 15 starter names in each of FR, AR and EN. Existing approved, pending,
   rejected or edited rows keep their original state, so all 45 variants need not
   be drafts. Only newly inserted rows are drafts.

The migration runner prints `Existing templates reclassified` after committing
0007. Preserve that output together with the backfill JSON for staging counts.
An already-applied migration is skipped; its previous count is not reconstructed.
No staging counts can be inferred from local regression fixtures.

The template list API accepts independent group, language and status parameters,
combined with AND and always scoped to the authenticated merchant. Invalid
filter values are rejected by the existing API validation error handler.
