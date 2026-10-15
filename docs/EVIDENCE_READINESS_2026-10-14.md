# Evidence readiness and operator runbook

Current-status update, 15 October 2026: runtime `e0fa9a3` is deployed and the [production E2E record](PRODUCTION_E2E_2026-10-15.md) documents fresh acceptance and limits. The [current handover](HANDOVER.md#current-release-and-production-acceptance-15-october-2026) supersedes older local/pending statements for the covered features. The dated findings below remain historical evidence; no blanket go-live or issuer verification is implied.

Migration 084 and the evidence transport rollout are installed/accepted on the shared demo target; see [the evidence rollout](EVIDENCE_PRODUCTION_ACCEPTANCE_2026-10-14.md). Retention is still dry-run only, and actual storage inventory/recovery checks below remain pending.

## Implemented increment; release still pending

Skill evidence accepts validated PDF, JPEG, PNG and WebP inputs up to 10 MB. Images are normalized to WebP, stripped of metadata and compressed to at most 1 MB. PDF bytes remain unchanged after structural validation. Certificate uploads retain the separate 5 MB limit.

Hosted acceptance exposed Vercel's 4.5 MB function request/response payload limit ([provider documentation](https://vercel.com/docs/functions/limitations)). Uploads above 3 MB now use sequential authenticated parts stored in the existing private container, bound to actor, target, revision, upload ID, MIME, filename and total size. Each part rechecks edit authority/revision; assembled contents pass the existing validator and transactional SQL mutation before becoming evidence. Certificate intake/replacement and explicit AI autofill use the same bounded transport. File responses stream only after authorization and snapshot rechecks. No public container or signed storage URL is introduced. Committed intermediate objects are retained for dry-run inventory; incomplete block uploads do not represent saved evidence.

An owner editing a skill can explicitly choose **Use as certificate** for a pending or saved evidence file. The certificate form opens with that file and the skill linked. The user supplies or reviews credential details and can explicitly request AI autofill. No file is silently shared with AI or automatically approved. A file above 5 MB remains ordinary evidence and cannot be promoted. Saved originals remain retained history.

Migration 084 adds file metadata to skill evidence and updates submission snapshots and scoped Analytics file projections. It preserves current owner, assigned current-manager, submitted-state, active-status, revision and permission checks. Private drafts remain private. Install and verify the migration together with the API/web release before advertising PDF skill uploads. This document does not establish that the increment is deployed.

Ownership verification stays manual through existing manager review, feedback and audit. Approval is a manager decision; it is not a claim of issuer authenticity or independently verified ownership. Issuer integration and a separate verification workflow are deferred.

## Retention decision

The user selected **dry-run only; deletion policy later**. There is no delete command or cleanup scheduler in this increment. Referenced, unreferenced and uncertain objects are all retained.

Run `npm run evidence:inventory -w apps/api` in the configured operator environment. The command requires the configured account, SQL connection and private evidence storage configuration. Do not copy credentials into reports. It scans only the configured account's blob prefix, without downloading file contents. It includes current evidence, certificate records, active/transferred intake files, submission snapshots and historical audit references. Malformed history or a workspace revision change marks the report incomplete. An unreferenced observation is not permission to delete.

Output: ignored `.local/evidence-storage-dry-run.json`. Protect this report as internal account metadata. It reports zero deletions and whether reference scanning completed. Blob soft-delete settings are observed when permitted; container recovery and versioning require a separate management-plane check. Missing configuration or inability to observe recovery settings must not be reported as successful verification.

Before deciding deletion policy, obtain an approved retention period, legal/history requirements, restore procedure, treatment of ambiguous uploads and responsible owner. Keep all objects referenced by immutable review snapshots and audit history. Recheck references and concurrent writes immediately before any future deletion implementation.

## Hosting acceptance checklist

Organization hosting and SSO remain deferred. Assign an operator and agree RPO/RTO before go-live. Record actual provider configuration and recovery evidence; a written checklist is not a completed restore drill.

1. Verify SQL backups and point-in-time recovery for the chosen database service. Verify the private Blob container's recovery/versioning settings and retention window independently. Record encryption, network access and operator permissions from the actual host configuration.
2. Restore SQL and files into an isolated environment. Reconcile account IDs, file references, review snapshots, revisions and renewal lineage. A SQL-only restore is insufficient if the corresponding attachments cannot be recovered. Keep restored accounts disabled until consistency and access checks pass.
3. Test owner and current assigned-manager reads, scoped submitted-file Analytics reads, DENY overrides, inactive users and no-self-review. Confirm exports contain only authorized records and private attachment URLs never become public.
4. Monitor API health/readiness, database availability, upload failure/latency, private storage access, AI timeouts and notification transport/reconnects. Preserve request IDs in incident reports; avoid credentials, full file content and private notes in logs.
5. For partial downloads, reject the truncated response and retry with fresh authorization. For uncertain upload commits, retain the object and reconcile SQL/audit before attempting another mutation. For storage/AI outages, show a recoverable error and preserve the editable draft.
6. Rehearse rollback and forward recovery for schema/application releases. Confirm compatibility before rolling back an API against a newer schema. Verify deployed artifact versions and migrations before interpreting hosted test results.

## Acceptance record for this increment

- Restricted-runtime SQL rollback tests cover PDF metadata, foreign owner, stale revision, canonical object path, unsupported MIME and 10 MB size enforcement. The fixture rolls back all changes; it does not install migration 084.
- File validation and HTTP tests cover independent skill/certificate limits, invalid files, request identity, revocation and upload uncertainty. Inventory tests cover history, incomplete scans, cross-account exclusion and zero deletion.
- Real storage inventory is pending: the current local operator environment has no evidence-storage connection/container configuration. No real object scan or restore drill is claimed.
- On the existing hosted release, the signed-in demo owner could open an approved skill's linked certificate disclosure and see its private PDF preview (page 1 of 1), View and Download actions. This read-only check did not create or approve test records and does not establish new skill-PDF upload or two-session notification acceptance.
- Hosted acceptance of the new skill-PDF increment requires its coordinated deployment/migration first. Separately verify upload → multi-skill linking → current manager review → Analytics/export reconciliation and two independent sessions' notifications. Existing hosted functionality cannot prove an unreleased increment.
