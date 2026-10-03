# Enterprise catalogue v1

The supplied list contains **70 skills**, despite the introductory count of 60. All entries SKL-001–SKL-070 and all ten categories are included in [the reviewed seed](../database/seeds/enterprise-catalogue-v1.json). Every entry has a definition and five skill-specific criteria. Java retains the supplied definition and criteria verbatim. Other criteria are initial application rubrics and can be reviewed and refined by catalogue administrators.

## Storage and identity

Migration 012 preserves internal skill UUIDs, existing custom levels, claims and audit records. `business_code` is a nullable, workspace-unique, immutable identifier, such as SKL-001; it does not replace UUIDs in API routes or claim relationships.

`ProficiencyFramework` → `ProficiencyLevel` stores Awareness, Beginner, Intermediate, Advanced and Expert **once**, including their general definitions. `SkillDefinitionVersion` references a framework. `SkillVersionCriterion` maps each version and rank to its specific criteria. The 70 seeded skills share the enterprise-v1 framework and have 350 version-specific criteria; the 350 criteria do not duplicate the common labels or general definitions.

`SkillCatalogue` is the current metadata projection. Its `definition_revision` selects the current immutable definition version. Saves create a new version and audit event atomically, with workspace revision checks. Revision numbers are workspace revisions, not sequential per-skill version numbers. Existing read/claim procedures use the read-only `SkillProficiencyLevel` compatibility view, which joins the current version's criteria to shared labels. Old version rows are never updated or deleted by catalogue saves. Runtime identity has procedure execution only, not direct table writes.

Existing arbitrary one-to-eight-level definitions migrate into private frameworks. Subsequent saves reuse a framework when labels/ranks match, including automatic reuse of the enterprise framework for the exact five standard labels. Editing labels can create a private framework; it does not rename shared enterprise levels. New UI forms start with the five standard labels and require specific criteria before publishing.

The migration can preserve only definitions present at migration time. Older claim revisions already carry frozen name/level/criteria snapshots; those remain readable. Complete pre-migration definition history cannot be reconstructed. New claims capture the current version revision and immutable snapshots. Claim transitions continue to validate current publication/revision before submission.

## States and interpretation

The supplied `ACTIVE` catalogue status maps to existing **PUBLISHED**, so employees can discover and claim seeded skills. The supplied `VERIFIED` claim concept maps to **APPROVED** after assigned reporting-manager review; this is a manager-reviewed proficiency claim, not a certification or an AI assessment. Draft/submitted/returned/rejected claims remain separate states.

Evidence references and projects are part of claims, not proficiency masters. Future matching must consider the required skill and rank, approval status, review/evidence date and applicability. No matching engine or evidence-freshness scoring is shipped by this seed.

## Provisioning

Run from the repository root with the configured development workspace and linked Microsoft owner:

```powershell
npm run db:migrate -w apps/api
npm run catalogue:seed -w apps/api
npm run catalogue:seed -w apps/api -- --apply
```

The CLI requires `NODE_ENV=development`, `ACCESS_ACCOUNT_ID`, `ENTRA_TENANT_ID`, and explicit `ROLE_PRESET_OWNER_OBJECT_ID`. These identify the existing workspace and linked administrator; the CLI rechecks the current catalogue-management permission. Setup requires the existing authorized local Azure database operator login; no secret is placed in the seed. Do not expose this operator command over HTTP or run it on app startup.

Default is a read-only plan. `--apply` creates missing business codes in one transaction through `SaveSkillCatalogue`, using bounded validated payloads, a workspace lock, optimistic revisions and a separate audit event per skill. Existing business codes are preserved even if their definitions were customized. A conflicting existing name without the expected business code aborts before writes; it is never silently merged or overwritten. Re-running a complete seed creates zero skills and produces no catalogue-change audit events.

The seed is versioned in Git; future changes require explicit catalogue edits or a separately reviewed migration, rather than overwriting definitions whenever an app deploys.

## Verification

```powershell
npm run typecheck
npm test
npm run test:framework -w apps/api
npm run test:catalogue -w apps/api
npm run test:claims -w apps/api
npm run test:reviews -w apps/api
```

Unit checks validate all 70 codes, definitions, categories and five-level criteria, malformed seed rejection, collision handling and idempotent planning. Rollback-only real SQL checks cover shared labels, retained historical criteria, current-version selection, immutable codes, catalogue permission boundaries, published discovery, claims and assigned-manager review transitions. Migration 011 also fixes empty search returning no catalogue/claim choices. Hosted browser acceptance covers real public catalogue navigation and review flows using explicitly synthetic QA data.
