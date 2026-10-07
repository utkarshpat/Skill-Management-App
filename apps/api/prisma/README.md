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

Until the SQL-only features have a reviewed migration-generation and application
path, `database/migrations` remains authoritative for database changes. Run `db:validate`,
`db:generate`, and `db:baseline` before relying on the schema/client artifacts.
