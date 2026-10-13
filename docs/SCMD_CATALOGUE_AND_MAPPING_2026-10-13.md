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
npm run catalogue:scmd -w apps/api -- --operator=<existing-person-uuid> --apply
```

This is an explicit development-account operation, never a startup action or public endpoint. It requires an active linked operator with catalogue management and governed approval authority. Preview records a receipt covering the source, access revision and current masters; apply rechecks it inside a transaction. Skills are created through `SaveSkillCatalogue`; provider/credential definitions and mappings use audited PROPOSE and APPROVE_AMENDMENT operations with fresh access revisions. Existing matching names/codes are retained. The operation adds no user roles, certifications, claims or approved employee outcomes.

Before applying, install migration 078 after coordinated release validation. Scheduler migration 065 remains deliberately deferred. A provisioning rerun must first produce a fresh preview; already-existing definitions are preserved rather than silently updated.

## Verification and release status

Rollback SQL checks passed using the restricted runtime principal: multi-skill mapping and personal OPTIONS, mapping replacement, invalid skill rejection and employee approval denial. All fixture master records and DDL roll back. API validation and frontend tests cover duplicate/invalid IDs, wrong master type, exact credential/issuer matching and multiple skill suggestions without inferred proficiency. The seed test verifies all eleven FDD areas, four labels, real sourced names and valid mapping references.

Permanent migration, provisioning, hosted UI and end-to-end acceptance status is recorded below as each step completes. A checked title does not establish that the employee owns or has passed that credential, or that its issuer has verified the uploaded file. Real organization SSO and upstream-directory acceptance remain deferred.
