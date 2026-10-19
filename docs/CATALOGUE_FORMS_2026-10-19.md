# Catalogue forms and shared proficiency criteria

Status: migration 086 was reported installed on organization development. The follow-up described below requires migration 087 and its matching API/frontend release; 087 rollout and hosted acceptance remain pending.

## Approved behavior

- Direct skill creation/editing retains `skill.catalogue.manage`. Migration 086 used certification/provider amendment approval; the approved 087 follow-up below additionally allows direct writes under the existing full catalogue approval authority. Request-only users retain amendment approval. No grants or scopes change.
- Skill add/edit uses one form with details, optional associated certifications and a read-only common proficiency reference. Certification amendments explicitly offer no default skill suggestions or optional related skills. Skill amendments use the same common criteria and optional certification picker.
- Catalogue associations are suggestions. Personal combined submissions still require 1–10 skills, and every certification must link to at least one selected skill. Employees may skip mapped suggestions, choose another published skill and add extra skills. No automatic claim, proficiency assignment or approval is introduced.

## Why definitions remain in SQL

Skill names, categories, descriptions, publication status and version identities remain variable data. The shared rubric already lives in `ProficiencyFramework`/`ProficiencyLevel`. Migration 086 normalizes future skill saves and proposals from that server-owned framework. API and frontend constants mirror its existing enterprise-v3 wording; modified requests cannot save custom criteria.

`SkillDefinitionVersion` and `SkillVersionCriterion` remain version records. Existing employee claims, review snapshots and historical criteria are not rewritten or deleted. Four criterion rows per new version remain for compatibility with versioned readers and historical evidence; schema removal would require changing all those consumers. This increment removes per-skill criteria editing, not historical storage. Existing definitions adopt common criteria on an explicit save; it performs no bulk alignment.

## Mapping integrity

Skill-side edits use the existing account-bound `CredentialSkillMapping` relation. Omitted mapping fields preserve associations for older clients; an explicit empty array clears them. IDs must be unique and account-bound, with active credentials required for new associations. Existing retired associations may be retained or removed. Each skill supports up to twenty certifications and each certification up to twenty default skills.

SQL rechecks runtime binding, catalogue permission and workspace revision in the existing locked transaction. Skill before/after audit includes certification IDs. Mapping changes increment affected credential revisions to protect pending credential amendments. Skill proposals also capture server-generated mapping state for approval-time conflict checks. The installed workflow is patched with guarded anchors so later recovery and authorization checks remain intact. The new paginated certification-choice read exposes catalogue metadata only and grants runtime only procedure execution.

## Rollout

1. Apply migration 086 through the normal migration runner or execute the reviewed SQL file in SSMS under the migration operator. Keep the migration ledger consistent with the deployment process.
2. Deploy frontend and API together. No employee-data migration is required.
3. Check authorized direct skill edits, associations from both catalogue directions, clearing suggestions, amendment preview/approval, stale revisions and denied access.
4. Verify employee certification submission still requires a linked skill, accepts other/additional published skills, and retains existing owner/current assigned-manager and history behavior.

Automated coverage includes API normalization, bounded association input, unchanged HTTP authorization, shared client/server wording, read-only rendering and claim link requirements. The opt-in `apps/api/test/catalogue-forms.integration.ts` suite is guarded to the original `skill-management-dev` database and rolls back all DDL/data. It checks mapping round trips, omitted/cleared mappings, unknown IDs, stale revisions, denied actors, conflicting amendments, a successful skill amendment, reciprocal mapping limits and procedure restoration. It does not deploy to organization SQL.

## Local verification - 19 October 2026

- Full automated suite: 339 API, 254 web and 7 architecture/packaging tests passed.
- Nine SQL scenarios passed with all DDL, fixture data and audit changes rolled back; the original catalogue procedure definition was checked after rollback. Amendment details resolve linked names, and mapping-only conflicts are visible before approval.
- Local browser checks with synthetic API fixtures covered both forms, aligned controls, optional-association clearing and certification selections retained across searches. These are not hosted end-to-end acceptance.
- Typechecks, production builds, architecture boundaries and generated documentation checks passed. The old per-skill criteria editor and its unused frontend helpers were removed.

## Release re-audit

The pre-release audit found that credential-side approval could exceed the skill-side twenty-certification limit. Migration 086 now checks the inverse relation before replacing credential mappings, without blocking an existing link simply because it is already at the limit. Rollback tests cover rejection of a twenty-first certification and successful skill amendment approval. The hosting ZIP contains application sources, not database migrations: apply the separately supplied target-guarded SSMS migration/ledger script before uploading the ZIP. Remote build and `npm start` remain required.

## Follow-up: direct catalogue management (migration 087)

The user approved optional descriptions with examples, explicit Add skill/Add certification entry points, footer draft/publish actions, and direct certification add/edit for users already authorized to approve catalogue changes. Migration 086 was reported installed on organization development (latest 86, 85 ledger rows; 065 is reserved). Migration 087 and this follow-up application build have not been installed there.

- Skills, Certifications and Amendments are separate catalogue sections. Certification definitions can have zero suggested skills. Combined personal certificate claims still require at least one linked skill; suggestions never restrict other published skills.
- Skill description is optional in API, forms and SQL. The exact legacy publication-description CHECK is removed; name/category, valid status and four common proficiency criteria remain enforced. Historical versions and employee claims are unchanged. Draft, publish and archive are explicit footer actions.
- Existing certification edits retain their issuer automatically. New certifications choose an existing issuer, or an authorized administrator enters a missing issuer in the same form. SQL reuses the matching issuer or creates it atomically with the certificate. There is no separate Add provider entry point for administrators and no inference from certificate titles.
- Direct `SAVE_MASTER` uses the existing full catalogue approval bundle: own profile access, permissions administration, people administration, audit access, catalogue management and no matching request-approval DENY. API preview, confirmation and SQL recheck current authority. A skill-management grant alone does not grant direct certification writes. Request-only users still submit an amendment for approval.
- Saves lock the account workspace, validate account-bound definitions and published mappings, recheck revision, transact and audit. Intent receipts support retries without duplicate entries. Recovery rechecks current authority and exact normalized input. Direct saves create no amendment request or claim. The generic direct skill path retains its skill audit and reserves a second revision for its intent receipt.
- Run migration 087 before the corresponding web/API release. Do not rerun 086 or import old test data. Manual SSMS rollout remains an operator action; local SQL acceptance uses the original development test database and rolls everything back.

Validation commands: `npm run typecheck`, `npm test`, `npm run architecture:check`, `npm run build`, `npm run docs:check`. SQL follow-up: set `RUN_DIRECT_CATALOGUE_SQL_TESTS=1` and run `node --env-file-if-exists=apps/api/.env --import tsx apps/api/test/direct-catalogue.integration.ts`. Hosted acceptance remains pending.

Follow-up verification: 601 automated checks passed (340 API, 254 web, 7 architecture/packaging unit checks). Local browser fixtures verified optional skill description, footer actions, direct certification preview with an inline issuer and no suggested skill, and request-only catalogue actions. These checks use synthetic browser data and do not establish hosted acceptance. Nine rollback-only SQL scenarios passed on `skill-management-dev`, including issuer reuse, no-skill certification, optional description, valid mapping preservation/clearing, foreign mapping rejection, stale revision, unauthorized writes, exact retry binding and current DENY/deactivation during recovery.

### Organization migration recovery, 19 October 2026

The operator supplied ledger version 086 and the full installed `SaveSkillCatalogue` definition. Whitespace-normalized comparison matched reviewed 086 plus the optional-description procedure patch exactly; no need to replay 086. The first 087 script incorrectly required that optional-description change to be absent. The corrected first batch accepts either the original reviewed guard or its already patched form, preserves an already compatible procedure, drops only the exact legacy description CHECK if still present, and rejects unrecognized procedure definitions. The outer target, predecessor, transaction and ledger checks remain intact. User execution and final 087 acceptance are still pending. The application ZIP is unchanged by this migration-only correction.

Recovery verification: all twelve rollback SQL scenarios passed, including a prepatched procedure with the legacy table check still present, the already completed description batch replayed twice, and rejection of an unrelated procedure definition. Original procedures were verified restored after rollback. The corrected target-guarded SSMS artifact is `artifacts/org-dev-migration-087-fixed-b6a442d8c49d.sql`; its three decoded SQL batches match the tested source exactly. Existing ZIP `skills-appservice-ab9535c47820.zip` remains the application release for this migration.
