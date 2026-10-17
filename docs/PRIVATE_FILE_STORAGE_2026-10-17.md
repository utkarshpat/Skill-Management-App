# SQL and Azure Blob private file storage — 17 October 2026

## Status and activation

Implemented; the operator reports applying migration 085 and deploying `skills-appservice-9c85260489af.zip` to organization development with `STORAGE_IS_SQL=true`. Independent homepage, health and access-code-gated demo discovery HTTP checks passed after deployment. Organization SQL content persistence and authenticated upload/read/review flows remain unverified; no existing file migration was performed. The existing testing deployment keeps its legacy Blob behavior unless the provider is explicitly configured. Real employee SSO, Azure AI and Redis are independent work.

Apply reviewed migration 085 with the separate setup identity, then manually deploy the matching tested ZIP. Set `STORAGE_IS_SQL=true` to store new file content in Azure SQL. Keep the existing runtime managed identity and account binding. There are no Blob credentials required for a fresh SQL-only environment. Runtime receives EXECUTE on three reviewed procedures, not table-wide access. Application startup never runs migrations.

## Storage contract and switching

`PrivateFileStorage` separates file operations from HTTP routes. New files retain stable file IDs and existing account/record/object reference conventions. `PrivateFileObject` stores the provider per file, size, SHA-256, canonical filename, original uploaded name, MIME type and provenance. SQL files contain `VARBINARY(MAX)` content; Azure Blob records retain metadata/checksum without duplicating content in SQL. Metadata/list/Analytics queries do not join binary content.

Explicit `STORAGE_IS_SQL=false` selects Blob for **new** writes and requires the normal private container/connection settings. Both providers use the same filename, registry and authorization contract. Reading uses each file's recorded provider, so existing SQL files remain readable after selecting Blob for new uploads. When existing Blob files also need to be read, retain its connection even if new uploads use SQL. Legacy unregistered references remain Blob-backed. Missing SQL content does not silently fall back to Blob.

Changing the setting does not move existing bytes. A later transfer must copy bytes, verify length/SHA-256, atomically switch the registered provider/reference and preserve old versions according to retention policy. Such a bulk migration/deletion tool is not implemented or run here. Do not unset the provider after adopting the registry: unset means the historical Blob-only implementation, intended for compatibility with the unchanged testing deployment.

## Uploads, filenames and transactions

After existing validation/compression, SQL content, file metadata, attachment association, counter and normal access audit commit in one transaction. Existing owner/editable-state/revision checks remain canonical through `SkillEvidence`, `CertificationImage` and `CapabilityIntakeFiles`. Metadata rejection rolls back SQL bytes and counter. Blob uploads use immutable IDs and keep uncertain/unreferenced objects rather than deleting potentially committed data.

Names are derived from the current employee record, never from caller-supplied employee identity:

- `DEMO-NHS-012_Hemant_Navlakha_cert1.pdf`
- `DEMO-NHS-012_Hemant_Navlakha_evidence1.pdf`

Counters are serialized per account/person/type across new provider-managed files; replacement/removal does not reset them. Names use safe ASCII tokens and retain the actual stored extension (images normalize to WebP). Original uploaded names are retained separately. Internal object IDs prevent overwrites even when display names normalize alike. Existing filenames/history are not rewritten and legacy files are not retroactively renumbered.

Certificates retain their 5 MB supported-format limit. Skill evidence retains PDF/image support up to 10 MB input, with validated images normalized/compressed to WebP under 1 MB. Files are not base64 fields in business JSON.

In SQL mode, `PrivateUploadPart` provides durable actor/account/binding-scoped staging for uploads and explicit AI intake, including multi-instance/restart recovery. Each binding covers actor, target, revision, upload ID, count/size, MIME and name. Repeated identical SQL parts are idempotent; changed/incomplete parts fail. SQL assembly verifies every part checksum and total length. Bindings older than 24 hours cannot be resumed; retained bytes are not automatically deleted. Blob mode instead stages/assembles private native Blob blocks through the shared adapter, without copying new staging payloads into SQL. Both paths preserve existing resource/revision checks and validate the prepared file before registering its final checksum.

## Reads, snapshots and policy

`ReadPrivateFile` resolves authorized metadata through the SAME existing SQL procedures, using an optional internal manifest output that leaves their public result sets intact. It does not infer file authority from an ID, title or storage path. Owner/current assigned manager, active person/account, review state, current reporting and matching scope DENY checks continue to apply. Intake files are owner-private. Combined immutable submission snapshots preserve earlier file versions. Analytics files remain restricted to authorized scoped submitted/approved records.

Application readers recheck metadata/access after byte retrieval and verify exact length and registered SHA-256 before returning bytes. The read procedure returns binary only for the selected authorized file, and never grants list/history browsing over the object table. No runtime table-wide reader/writer or db_owner membership is introduced.

## Retention and operations

All registered versions and staging parts are retained. `npm run evidence:inventory -w apps/api` remains **dry-run only**. With an explicit provider, it writes metadata-only registry inventory and retained staging totals to ignored `.local/private-files-dry-run.json`; it does not scan unregistered/legacy Blob objects and does not claim a complete orphan scan. Without a provider, the existing Blob inventory remains available. No deletion operation is introduced.

SQL file payloads increase database size, transaction logs and backups. Organization operators must verify SQL capacity, backup retention and an actual restore before readiness claims. SQL storage does not itself provide malware scanning or issuer/ownership verification. Binary payloads stay outside any future application cache.

## Verification and remaining acceptance

Local unit regressions cover provider configuration, per-file routing, checksum/size corruption, stale membership after download and durable chunk assembly. The rollback-only SQL suite exercises the actual migration and restricted runtime procedures on the existing development test database, reverting DDL and fixture data. Run only with an explicit development test opt-in:

```powershell
$env:RUN_PRIVATE_FILES_SQL_TESTS='1'
npm run test:private-files -w apps/api
```

Organization acceptance is still required after applying migration 085 and deploying matching code: certificate-first intake → autofill/manual fields → multiple linked skills → manager review → scoped Analytics preview; ordinary PDF/image evidence; renewal/replacement history; denied foreign/draft files; larger multi-part files; and SQL/Blob provider transitions with a private container. AI extraction additionally requires an approved configured provider. Do not claim these hosted flows passed from local tests or health checks.

Use only `STORAGE_IS_SQL` for new configuration. The previous `EVIDENCE_STORAGE_PROVIDER` setting remains supported for compatibility; conflicting settings fail startup rather than selecting an unintended provider.
