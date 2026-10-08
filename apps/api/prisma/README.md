# Prisma schema and SQL Server migrations

`schema.prisma` defines the Prisma client-facing model and relation shape. It cannot
express every SQL Server feature used by this application. In particular, filtered
unique indexes and `rowversion` columns remain defined by the reviewed SQL migrations.
They are deliberately not represented as ordinary Prisma indexes because doing so
would silently lose their uniqueness predicates.

The root `db:diff` command exports a complete schema from an empty database; it is
not an incremental migration and must not be applied to a database that already has
the SQL migration history. `db:baseline` is read-only: it verifies migrations 001-052
and checks that the filtered unique indexes and `rowversion` columns required by
existing SQL migrations are present. It does not claim that every table, check
constraint, procedure, or view has been compared with the Prisma schema.

## Schema-driven migration workflow

`schema.prisma` is the source for new schema changes; the SQL files in
`database/migrations` stay the executed, reviewed artifacts (the 001-052 history is
unchanged).

1. Edit `schema.prisma`.
2. Run `npm run db:migration:new -- <snake_case_name>`. It diffs the schema against
   `prisma/applied-schema.prisma` (the snapshot of what migrations already cover),
   writes the next numbered `database/migrations/NNN_name.sql` (Prisma's own
   transaction wrapper removed; the runner supplies it), and updates the snapshot.
3. SQL-only features Prisma cannot express are declared in `src/sql-features.json`
   (filtered unique indexes, `rowversion` columns, check constraints) and are
   generated into the same migration (snapshot: `prisma/applied-sql-features.json`).
   A rowversion column must be declared together with the new `Bytes @db.Binary(8)`
   column in `schema.prisma`; converting an existing column is rejected. The baseline
   verifier (`db:baseline`) reads the same file, so declaration, migration and
   verification cannot drift.
4. Review the SQL, then run `npm run db:migrate`; migrations are discovered from the directory.

`npm run db:schema:check` (also run in CI) fails if `schema.prisma` or
`sql-features.json` changed without a generated migration. Prisma's `migrate dev` is
intentionally not used: it needs a shadow database. Views and stored procedures are
still hand-written SQL migrations.

have a reviewed migration-generation and application
path, `database/migrations` remains authoritative for database changes. Run `db:validate`,
`db:generate`, and `db:baseline` before relying on the schema/client artifacts.
