# Skill catalogue

Implemented 2 October 2026 as the first part of the employee skill workflow. These are technical skill definitions; workplace evaluations, employee claims and verification are separate future records.

## User workflow

Administration contains Skill catalogue, with New skill in its page navigation. Define a name, category, description and one to eight sequential proficiency levels. Level names and criteria are editable. The three initial Level 1/2/3 rows are blank drafting aids, not an approved company rubric. Category is workspace-managed text, with suggestions from the current results; separate category governance is not yet implemented.

Drafts are visible only to catalogue managers. Publishing requires a skill description and criteria for every level. Archived skills remain stored for history but are hidden from ordinary viewers. Managers can edit and restore definitions by changing status; there is no delete endpoint. Skill names are unique within a workspace regardless of letter case. Name/category whitespace is normalized on the API.

The catalogue has search by skill/category, status filtering for managers, 25-item server pagination, a selected-skill editor and read-only proficiency details. Save skill remains within the editor. The employee profile exposes /skills when the current identity has catalogue access; it uses the same API without requiring permission-administration access. Temporary development sessions also use current permissions and retain their loopback/origin restrictions.

## Authorization and persistence

- skill.view at ORGANIZATION scope reads only PUBLISHED definitions. Draft/archived records are excluded from the rows, search counts and proficiency results.
- skill.catalogue.manage at ORGANIZATION scope reads and manages all definitions. Permission administration and role names do not imply this permission. Explicit DENY, expiry and inactive membership apply. OWN does not grant authority over the workspace catalogue.
- Capability/team/department scopes remain unsupported proposals in the editable presets. No preset was widened to ORGANIZATION to enable this increment. The verified personal Microsoft owner received an explicit, audited individual catalogue-management ALLOW through the existing access-change service.
- Identity and account come from the verified mapping or development session. Client actor/account fields are ignored; IDs are generated on creation. All SQL inputs are parameterized.

Migration 007 adds SkillCatalogue and SkillProficiencyLevel with account-scoped keys, foreign keys, case-insensitive name uniqueness and status/level constraints. ReadSkillCatalogue and SaveSkillCatalogue check the runtime principal's account binding and current actor grants. Runtime has EXECUTE on these procedures, not direct table read/write grants.

Each write locks the shared AccessWorkspace revision, rechecks permission, validates the definition and levels, persists the change and adds AccessAudit before/after JSON in one transaction. The skill records definition_revision as the resulting workspace revision. Concurrent changes return 409; the editor retains the unsaved draft and its original revision. Reload and reselect the current skill to reconcile it before saving again. A successful save is acknowledged even if the subsequent refresh fails, so the UI does not suggest resubmitting the creation.

Definition history is retained in audit, and archive preserves the record. Before implementing employee claims, add durable claim-to-definition-version references and migration rules for changed proficiency criteria. Editing a definition must not silently reinterpret existing claims. No employee skills are marked verified by this catalogue.

## Setup and verification

Run npm run db:migrate -w apps/api with the approved setup identity. Keep ACCESS_ACCOUNT_ID and the restricted runtime configuration. The personal development database has migrations 1–7 applied. No example skill records were seeded.

Checks: npm run typecheck, npm test, npm run build, npm run test:catalogue -w apps/api. The catalogue SQL integration test uses the restricted identity and rolls back all fixtures/audit changes. It verifies published-only visibility, 25-row pagination, case-insensitive uniqueness, create/archive, required criteria, unauthorized and stale writes, missing/cross-account targets, atomic audit and denial of direct table access. It compares complete before/after snapshots to confirm cleanup.

Browser verification covers the real Microsoft owner's empty state, New skill action/focus, draft editor and published-field validation. At 390px, the editor stacks and document scroll width matches available width; the original viewport was restored. Test form values were discarded without saving. A live employee review/claim flow remains the next increment.
