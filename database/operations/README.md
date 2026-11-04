# Reviewed company setup operations

These are DBA-run operations, not application migrations or runtime endpoints. Read [current operations](../../docs/CURRENT_OPERATIONS.md) and the approved access baseline before changing identities or access. Employee-specific generated SQL belongs only in ignored artifacts.

| Source                                        | Use / status                                                                                                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `real-user-cutover-preview.sql`               | Read-only account inventory. SQL hashes private bytes internally and exports only fingerprints/counts.                                                                             |
| `real-user-cutover.template.sql`              | Snapshot-bound cleanup/import template. Company cutover is already confirmed committed; do not replay it.                                                                          |
| `review-employee-identity-binding.sql`        | Exceptional single-person reviewed DBA bootstrap/reconciliation; not the required 20-user workflow.                                                                                |
| `bulk-employee-identity-binding.template.sql` | Reviewed directory/roster mapping, exact binding preservation, conflicts blocked, serializable apply and actual-operator audit. User reports the prepared 20-user batch completed. |

All apply paths require preview/review and target/state checks. Do not remove a conflict guard, guess a revision, replace an existing identity or disable constraints to force execution. Source email/UPN matching prepares pinned employee/person/object-ID tuples; runtime authentication uses verified tenant/object IDs. Templates do not grant the pending restricted lead scope.

Keep audit/source provenance and recoverable backups. Setup archives `OperationsRealUserCutover` and `OperationsIdentityBindingAudit` are separate from app-actor audit and migration-generated schema inventories. No runtime table grants are provided. Old bootstrap/demo deployment artifacts have been moved into ignored `artifacts/archive/pre-real-user-2026-11-05/` for historical recovery; those instructions are superseded.
