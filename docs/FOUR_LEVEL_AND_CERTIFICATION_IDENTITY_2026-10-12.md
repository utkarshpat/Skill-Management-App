# Four level proficiency and certification identity

Approved scope on 12 October 2026: keep Oracle content within existing catalogue management, adopt Foundation / Autonomous / Experienced / Expert, and prevent duplicate employee credentials without blocking genuine renewals. Additional SCMD reporting/integration requirements remain outside this increment.

## Four level framework

Migration 074 adds enterprise-v3 as a new immutable common framework and changes catalogue writes to four exact labels. Prior framework rows, definition versions, criteria and claim snapshots are not converted. New claim discovery exposes only aligned current definitions, and SQL rejects a new claim or definition switch to a previous framework. Existing saved historical claims retain their own version.

Current manager proficiency charts, AI team-gap analysis and business coverage use the four-level scale. Older framework claims remain visible in history and overall reviewed totals but do not qualify for new proficiency comparisons or matching. Demand requirements and skill amendments use four levels; a four-level framework is not simply a relabel of old ordinal ranks. Catalogue editor alignment clears prior-framework rubrics for explicit review. The new versioned seed contains four skill-specific criteria while the previous seed remains preserved.

Development inventory at review: 0 claims, 0 certificates, 0 demands; 70 general seed definitions on enterprise-v1 and one custom three-level QA definition. A permission-checked rollout preview proposes new versions for only the 70 unchanged seed rubrics. The custom definition is retained for explicit manual alignment and cannot be selected for a new claim while unaligned. No employee rank is reinterpreted or historical criterion overwritten.

## Credential duplicate identity

Migration 075 adds a transactional database guard for a new/changed credential belonging to the same account, employee and normalized issuer. A matching normalized certification name or a matching nonempty printed Credential ID blocks a separate record UUID. Case, repeated ordinary whitespace, tabs/newlines and nonbreaking spaces are normalized. An empty ID does not cause unrelated names to collide. Another employee or issuer is independent.

Application request identity/revision/idempotency remains distinct. Updating the same record, continuing its returned draft, or reusing a reviewed certificate does not create a second credential. Client-side advisory checks catch duplicate cards and already owned records; SQL rechecks after current authorization and within the serialized workspace write transaction, so a stale browser or a different UUID does not bypass the guard. Duplicate responses are safe HTTP 409 messages directing users to link/continue/Renew, without exposing another person's data.

A valid renewal supplies its source in the initial SAVE, including grouped SAVE, instead of attempting to attach it after the identity guard. Existing owner, approved source, same credential/issuer and extended current validity checks remain mandatory. Duplicates are exempted only against actual ancestors in that valid renewal chain. Parallel renewals continue to be constrained by the existing unique active-renewal index. A forged or unrelated source cannot exempt a duplicate. No existing records are silently merged or deleted; an older environment with existing duplicates needs an explicit cleanup review.

This identity rule assumes the printed ID is certificate-specific; a provider candidate/account ID shared by unrelated qualifications must not be entered as Credential ID. IDs remain optional and name/issuer fallback handles certificates without a printed certificate identifier.

## Validation and rollout

The four-level SQL rollback fixture verifies immutable old claim facts, new four-level rubric/version writes, exact history totals, exclusion of old Expert from new matching/coverage, and rejection of five-level writes. Credential identity rollback fixtures verify name/spacing/case duplicates, printed-ID aliases, no-ID duplicates, cross-employee isolation, genuine multi-generation renewals, foreign-source rejection and grouped renewal creation. Fixtures verify their test people are absent after rollback.

Permanent installation and catalogue rollout must be coordinated with the matching API/web deployment because this database also backs the hosted demo. Migration 065 scheduler activation stays deferred. Preview, current administrator/permission/revision rechecks, transaction and per-definition audit are required for the catalogue rollout. New versions preserve each existing skill's ID, code, name/category/status and previous history; Oracle skills are added through the existing governed catalogue/amendment flow.

Parallel local certificate-layout edits were observed during this work and are not part of this release's committed scope. Release checks should run against a clean snapshot containing only the proficiency/identity changes.
