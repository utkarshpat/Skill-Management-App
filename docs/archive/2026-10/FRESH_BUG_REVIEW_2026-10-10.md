# Fresh bug review — 10 October 2026

Reviewed commit `7bcb7e8d07ec8b0d8677c4766dd176a8ce04e935` after the previous full retest. This pass traced attachment writes, Business Operations SQL/authorization/matching/analytics, workflow UI, directory binding, shared reads and AI generation. The findings below are new relative to the preceding audit. Application code was not changed and no permanent migrations, grants, live messages or deployment actions were performed. The existing local edit to `SKILLS_CERTIFICATIONS_REFINEMENT.md` was preserved.

## Confirmed findings

### 1. P1 — An uncertain SQL outcome can delete an attachment that was saved

Location: `apps/api/src/modules/skills/evidence.ts:227–240`.

After uploading the private Blob, `upload()` runs the SQL `ADD` operation. Every rejection deletes the Blob, including timeout/connection failures that can occur after the transaction commits. The database can consequently retain a current attachment reference while the file has been deleted. For a certificate, metadata can still satisfy the mandatory attachment check while the reviewer cannot open its bytes. Skill evidence uses the same cleanup path.

Evidence: an isolated transport failure injection saved the `ADD` metadata and then threw `ETIMEOUT`. The actual store called `deleteIfExists`, leaving the simulated committed reference pointing at a deleted object. This is a deterministic control-flow reproduction, not an induced live Azure network failure.

Fix direction: distinguish a confirmed rollback from an uncertain commit. Keep uncertain objects private until an authorized reconciliation checks whether the generated attachment ID is referenced; use the same ID for retry/recovery. Immediate deletion is appropriate only when the absence of the reference is established safely.

### 2. P2 — Demand matching equates arbitrary historical ranks with standard proficiency

Location: `database/migrations/061_business_workflows.sql:38–40` (also used by `MATCHES` and `SHORTLIST`).

`BusinessMatchRequirements` compares only `claimed_rank >= minRank`. It never resolves the claim's definition version/framework. The application retains custom historical frameworks with up to eight levels; their ordinal ranks do not establish equivalence with the current five-level standard. An approved custom stage-eight claim therefore satisfies a standard L5 requirement without a mapping or a review against that standard. The chart's L5+ disclosure does not protect demand matching or shortlist execution.

Evidence: a development SQL rollback fixture created a separate custom framework/version and a reviewed claim at its rank eight. Calling the actual SQL matching function for an L5 requirement returned `matched=true` and the criterion `Manager-reviewed proficiency L5 or above`.

Fix direction: bind demands to a defined framework/definition contract and resolve the reviewed claim's framework before comparing. Treat unmapped historical levels as not established, or use an explicit approved equivalence policy. Preserve historical records and do not silently reinterpret their ranks.

### 3. P2 — The heatmap merges different skill IDs that share a historical name

Location: `apps/web/src/business/BusinessOperations.tsx:421–425`.

SQL returns coverage by skill ID, snapshot name and rank, but the UI groups rows by name and uses `find(name, rank)`. After a catalogue skill is renamed and its former name is reused for a different skill, approved claim snapshots can legitimately share a name across IDs. The UI selects the first cell, drops the other count and drills into only that first skill ID.

Evidence: a rollback fixture retained one reviewed claim with the old name, renamed its catalogue entry, and created another skill using that old name. SQL returned two rank-three cells with different IDs and one holder each. The UI's current selection expression displays one holder and one destination.

Fix direction: use stable skill IDs for grouping, keys and drill-down; resolve a consistent display label per ID and distinguish historical names. Counts must be deduplicated by person within the intended skill grouping.

### 4. P2 — Review activity history changes when a returned credential is resubmitted

Locations: `database/migrations/060_business_operations.sql:244`; `database/migrations/053_certification_records.sql:115`.

The dashboard builds submission/review trends from mutable `submitted_at` and `reviewed_at` columns on current claim/credential rows. Resubmission overwrites the submission time and clears `reviewed_at`; saving a returned record as a private draft also excludes that row from the analytics temporary tables. A past manager decision disappears, and repeated submission/decision cycles count only their latest surviving timestamps. An activity graph therefore loses completed historical events as normal workflows progress.

Evidence: in a rollback fixture, a credential with a recorded changes-requested decision was moved through the resubmission column changes used by `CertificationWorkspace`. The actual dashboard's current-month decision count decreased from five to four. The fixture simulates the state transition with SQL updates; it does not call the submission API or establish that an approved credential may be resubmitted.

Fix direction: calculate events from an append-only submission/decision history, filtered to current authorized people and the permitted business fields. If a current-row timestamp chart is retained, clearly label it as latest-state timestamps rather than activity totals; this does not provide the requested full event history.

### 5. P2 — Valid workflow notes can be rejected by the internal chat length limit

Location: `apps/api/src/modules/ai/assistant.ts:269–273` (chat validation at `:73`).

`workflowDraft` accepts up to 500 characters of notes, then packs those notes, up to 500 description characters, a 160-character title and instructions into one user message. JSON escaping expands quotes/backslashes/newlines. The subsequent `chat()` call applies the public 2,000-character user-message limit to this internally generated prompt. Valid form input can fail with a misleading length error before generation.

Evidence: a synthetic authorized workflow and provider, with a 160-character title, 500-character description and 500-character notes containing quotes, returned the 2,000-character validation error. The model was called zero times.

Fix direction: keep validated user input separate from bounded internal instructions/source context, or size the composed internal prompt against an explicit internal budget without weakening the public chat limit. Retain record authorization and the post-generation revision/access checks.

## Reproduction and limits

Ignored local repro files:

- `apps/api/.local/fresh-audit-unit.ts`: two failure-injection/synthetic-provider checks confirming the upload and AI prompt faults; both reproduced.
- `apps/api/.local/fresh-audit-sql.ts`: the existing restricted-runtime workflow/matching rollback scenario with three additional audit checks. It requires `RUN_BUSINESS_SQL_TESTS=1` and `BUSINESS_SQL_SCENARIO=workflow-and-matching`. It guards the development database name, rolls back pending 060–061 DDL/data/audit, and verifies that no fixtures or pending schema remain.

These are assertions of faulty behavior, not regression tests showing fixes. The SQL function/dashboard reproductions use synthetic records; the upload/model tests use mocked transports and no live Blob mutations or billable model calls. No authenticated hosted/browser/load acceptance is claimed. Permanent migrations 059–061 and reviewed activation remain pending. This review cannot establish that all repository bugs have been found.

## Local fixes

All five findings now have local corrections and maintained regressions. Uncertain uploads reconcile committed metadata or retain private blobs; definite SQL rejections clean up. AI facts use bounded fragments without weakening public chat limits or post-generation checks. Migration 062 supplies framework-aware matching, canonical stable-ID coverage and immutable audit activity. Regression checks cover transport outcomes, escaped full-length notes, reused names, legacy framework rejection, resubmission, return to draft and repeated events. SQL verification rolls back all fixtures and pending schema; permanent installation/activation and hosted acceptance remain pending.
