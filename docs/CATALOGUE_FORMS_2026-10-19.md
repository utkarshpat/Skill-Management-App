# Catalogue forms and shared proficiency criteria

Status: implemented locally. Migration 086 and the matching API/frontend release are required; organization deployment and hosted acceptance remain pending.

## Approved behavior

- Direct skill creation/editing retains `skill.catalogue.manage`. Certification/provider entries retain the existing amendment and approval workflow. No role receives new authority.
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
