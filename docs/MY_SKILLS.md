# My Skills: own self-assessed drafts

## Delivered scope

Employees can open `/my-skills` from My profile. Administrators have a My skills section in their existing sidebar. Both use the same component, authenticated API and own-person storage. No administrator bypass grants the right to claim skills: permissions must explicitly allow the action.

The table shows the skill, claimed proficiency, experience and `Draft · Unverified` status. The Add/Edit popup separates skill selection, published proficiency criteria and experience into short steps. Desktop forms do not add an internal scroll area; phone dialogs retain scrolling. Search and pagination fetch published definitions only. The description and level are self-assessments, not verified or certified capability.

This increment saves drafts only. Evidence attachment, submission, assigned reporting-manager review and verified status are the next workflow. Neither the UI nor AI claims a draft has been submitted or approved.

## API and permission contract

- `GET /api/my-skills?page=1`: own drafts, paginated at 25 rows; requires current `profile.view` OWN.
- `GET /api/my-skills/catalogue?search=...&page=1`: published skill choices and their current definition revisions; additionally requires `skill.claim` OWN and `skill.view` ORGANIZATION.
- `POST /api/my-skills`: create/update a draft; requires the same current claim permissions.

The server derives the person from verified Microsoft identity or the existing explicitly enabled loopback development session. Payload fields are limited to `id`, `revision`, `skillId`, `definitionRevision`, `rank`, `experienceMonths` and `description`. Owner, reviewer, status and verification fields are rejected. New drafts use a stable client-generated UUID and revision 0; existing drafts submit the revision they edited. Experience is 0–600 whole months; descriptions contain 1–2,000 characters.

## Persistence and concurrency

Migration 008 creates `SkillClaimDraft` and three narrowly granted runtime procedures. Each claim is account/person scoped with one draft per skill. Definition ID/revision, skill name/category and proficiency name/criteria are retained as a snapshot. Reads return only the trusted actor's drafts. Even an administrator's own endpoint cannot select somebody else's person ID.

SQL rechecks account/runtime binding, active membership and current effective permissions, including DENY. It only accepts currently published definitions and valid levels. Changing a skill definition or a draft during editing returns a conflict. Updating an existing draft cannot change its owner or skill. Claims maintain their own revision; workspace revision advances only to serialize the shared audit stream. Record changes and before/after audit events commit atomically.

The runtime can execute the procedures, not read or mutate the table directly. Draft saves have no effect on role assignments, reporting managers, notifications or request approvals. A repeated create cannot produce duplicate skill drafts; if a response is lost, reload the list and edit the existing record.

## Verification

Migration 008 was applied to the existing personal development SQL database on 3 October 2026. Live rollback-only tests exercised create/update, own-person isolation, duplicate protection, stale record/definition revisions, invalid levels/fields, explicit DENY and transactional auditing. Direct table SELECT and cross-workspace reads were denied. All integration fixtures were rolled back.

Unit/HTTP tests cover trusted actor resolution, forged ownership/verification fields, input bounds and live permission revocation. UI checks use an isolated in-memory workspace, not fabricated records in Azure. Full interactive Microsoft login is independent of these feature tests.

```powershell
npm.cmd run test:claims -w apps/api
```

This opt-in test requires two already-permitted test people and a catalogue/access administrator. It does not add permanent people, grants or skill definitions.
