# SCMD catalogue and governed credential mappings

The user requested actual FDD-aligned catalogue content for the client presentation, with the existing demonstration accounts retained. No sample credential definitions or fabricated employee achievements are provisioned. `database/seeds/scmd-catalogue-v1.json` contains the eleven FDD skill areas and eleven credential titles checked against [Oracle's official certification catalogue](https://www.oracle.com/education/certification/) on 13 October 2026. Oracle titles are source facts; related skill mappings and four-level descriptions are application defaults based on the FDD, not issuer endorsements or proof of proficiency. Existing catalogue items, older definition versions and employee records are preserved.

## Implemented increment

Migration 078 adds account-bound `CredentialSkillMapping` with credential and skill foreign keys. It extends the existing governed master amendment transaction, preserving all current actor/permission/revision/audit and retry checks. Credential amendments can carry up to twenty distinct published skill IDs. Approval rechecks those IDs in the same account and transaction before replacing the mapping. Historical amendments that omit mappings preserve existing links. No permission or scope grant is added.

Master listing and the current-definition review expose mapped IDs. Personal capability OPTIONS returns current published mapped skills and their exact versioned proficiency criteria. Selecting an approved credential suggests those skills; exact issuer/title matches after AI autofill add the catalogue defaults alongside AI suggestions. Employee selection is still explicit, proficiency is not inferred, and the employee must confirm certificate support in the normal combined flow. Catalogue suggestions are labelled separately from AI suggestions. Existing submitted employee snapshots and support links are never rewritten by a master mapping change.

The amendment mapping picker is bounded and scrollable. The form resets to four criteria, correcting a five-entry reset that blocked new skill proposals after the four-level migration. The previous audit corrections to review history, analytics labels, date/filter state and stale file/detail state are included in this release.

## Operator provisioning

Run from the API workspace with the existing authorized catalogue operator:

```powershell
npm run catalogue:scmd -w apps/api -- --operator=<existing-person-uuid>
npm run catalogue:scmd -w apps/api -- --operator=<existing-person-uuid> --verify
npm run catalogue:scmd -w apps/api -- --operator=<existing-person-uuid> --apply
```

This is an explicit development-account operation, never a startup action or public endpoint. It requires an active linked operator with catalogue management and governed approval authority. Preview records a receipt covering the source, access revision and current masters; apply rechecks it inside a transaction. Skills are created through `SaveSkillCatalogue`; provider/credential definitions and mappings use audited PROPOSE and APPROVE_AMENDMENT operations with fresh access revisions. Existing matching names/codes are retained. The operation adds no user roles, certifications, claims or approved employee outcomes.

Before applying, install migration 078 after coordinated release validation. Scheduler migration 065 remains deliberately deferred. A provisioning rerun must first produce a fresh preview; already-existing definitions are preserved rather than silently updated.

## Verification and release status

Rollback SQL checks passed using the restricted runtime principal: multi-skill mapping and personal OPTIONS, mapping replacement, invalid skill rejection and employee approval denial. All fixture master records and DDL roll back. API validation and frontend tests cover duplicate/invalid IDs, wrong master type, exact credential/issuer matching and multiple skill suggestions without inferred proficiency. The seed test verifies all eleven FDD areas, four labels, real sourced names and valid mapping references.

Permanent migration, provisioning, hosted UI and end-to-end acceptance status is recorded below as each step completes. A checked title does not establish that the employee owns or has passed that credential, or that its issuer has verified the uploaded file. Real organization SSO and upstream-directory acceptance remain deferred.

## Applied rollout

Release `0310ee4` completed Vercel deployment; its production composer bundle exposes catalogue defaults and their distinct label. Migration 078 was installed on `skill-management-dev`, also backing the production demo. Catalogue business codes use the existing `SKL-xxx` contract; the first attempt with a different prefix failed and rolled back without partial changes. The corrected provisioning then passed a complete transactional rollback verification before permanent apply.

Permanent apply added eleven FDD skills (SKL-071 through SKL-081), an active Oracle provider and eleven official-title credential definitions with related skills. Afterwards the database held 82 catalogue skills, of which 81 use the four-level framework and one preserves its custom framework. Employee inventory remained one claim and one certificate.

Full API tests passed (298), frontend tests passed (188 before the final recovery regression), and typecheck, builds, architecture and generated documentation checks passed. Eight combined-flow rollback cases passed: happy path, many-to-many counts, missing file, unlinked credential, changed manager, incomplete decisions, immutable snapshots and rerouting. These complement the four mapping-specific rollback checks.

Production browser verification recovered an incomplete private intake with its uploaded QA-only TXT attachment, authenticated View/Download controls, credential fields and one-year expiry preset. No skill/certificate claim or achievement was created. Reopening exposed a suggestion-recovery defect: defaults were only kept in form memory. The follow-up derives current published catalogue defaults from saved issuer/title and invalidates previous AI suggestions on file/identity changes. This does not infer proficiency or change stored support links.

Two tabs also confirmed that development login uses a browser-wide cookie: changing from Hemant to Khushi made the manager tab's subsequent evidence request correctly deny, and a fresh reload showed Khushi with no Reviews access. The stale previous-actor screen was a UX issue, not a reason to widen evidence authority. Demo sign-in/sign-out now send a credential-free invalidation signal to other tabs; receivers clear pending read/handoff state and reload to discover the current server-authenticated actor. Sending login also invalidates coalesced reads. Signals cannot select an actor, grant access or replay writes; Microsoft session behavior is unchanged. Different simultaneous demo actors still require separate browser sessions.

## Final production acceptance

Code release `d36f3fb` completed Vercel deployment. The final frontend suite passed 191 tests; the API suite passed 298. Typecheck, builds, architecture checks and generated documentation checks passed. Twelve SQL rollback scenarios passed across combined submissions and governed mappings.

After the recovery fix deployed, the production saved intake correctly suggested both Oracle OCI and Oracle OIC from the selected Application Integration credential. Explicit selection opened the four-level skill details dialog without preselecting proficiency. A blank experience description could proceed to the final review preview. Projects and evidence remained collapsed until requested. The centred Keep editing/Discard confirmation worked. The QA-only intake was recoverably removed after verification; no employee skill/certification achievement or review outcome was created.

After the session fix deployed, signing in as Hemant in one tab automatically refreshed the other tab to Hemant without a manual reload. The current assigned-manager combined review loaded the existing Utkarsh request, displayed its saved Autonomous proficiency and rendered the uploaded PDF first-page preview with authenticated View and Download links. No review decision was saved.

This acceptance covers production upload, private persistence/recovery, multiple catalogue suggestions, details, review preview, recoverable discard, manager read/PDF preview and cross-tab identity invalidation. Positive submit/decision paths were exercised with transactional rollback tests, not by approving an actual production employee record. Real SSO, separate-session positive real-time notification acceptance and organization scheduler activation remain outside this release's verified scope.
