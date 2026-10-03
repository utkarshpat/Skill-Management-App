## Guided skill entry (current UI)

Add/edit/AI-prefilled skill entry uses a three-step wizard: Select skill, Proficiency & details, Review & save. Category cards and counts come from published, workspace-scoped SQL discovery, never a static demonstration list. Search and category filters combine; paginated three-item result sets keep the laptop form compact. The selected definition remains visible across result changes. Editing an existing claim cannot change its skill.

Proficiency radio cards use the selected skill's actual versioned levels (including custom frameworks). Experience months and description are required; project/evidence references are optional. The final screen previews a self-assessed draft and links back to edit source details. It does not submit a manager review or mark the claim verified. AI suggestions follow the same explicit review/save flow. File uploads, primary-usage/last-used fields and expertise subskills shown in the design reference are not presented as supported controls: they need their own persistence/storage increment.

Laptop forms use a fixed modal, bounded result pages and a persistent footer. Phone/tablet widths up to 800px stack the panels and scroll the modal body; controls remain reachable. Shared tokens support light/dark themes. Native buttons, labelled radios, keyboard focus, Escape, unsaved-change confirmation, loading/error states and repeat-save prevention are included.

Migration 013 extends ReadClaimSkills compatibly with category, bounded page-size, definition description/business code and published category counts. Defaults remain 25 results for existing callers. Counts are workspace-scoped and published-only; up to 100 category facets are returned, with search available for any additional categories. SQL/API permissions and save revision checks are unchanged. Types, production builds, 93 automated checks and rollback-only real SQL category/pagination checks pass.


### Hosted Chrome acceptance, 3 October 2026

Verified the production wizard in the user's Chrome at its actual 1536 x 639 viewport: Java search and versioned levels, restored edit values, required-description validation, review edit navigation, keep-editing confirmation, and explicit Save changes. Next stops at the review screen; distinct keyed navigation/save buttons prevent a React DOM replacement from triggering an unintended submit. The labelled synthetic Java draft remains DRAFT, not submitted or approved. Refresh/edit restored 24 months, L3 and the QA project/evidence references. Selection, details and review use compact spacing, including inherited footer-margin correction. Query loading retains existing cards rather than blanking them.

The responsive viewport capability accepted 390 x 844 requests but Chrome continued to report 1536px width, including a fresh tab. Mobile stacking/body scrolling is implemented, but a true phone-width visual acceptance check remains outstanding. No mobile screenshot is presented as verified. Temporary viewport overrides were reset.

# My Skills: own self-assessed drafts

## Delivered scope

People with the required own-profile and skill-view permissions open `/my-skills` from their personal workspace sidebar. My skills is absent from administration; administrators can switch to Personal workspace through the account menu, where the same permission checks apply. The component, authenticated API and own-person storage are shared. No administrator bypass grants the right to claim skills: permissions must explicitly allow the action.

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
# Current submission and review flow

Migration 010 adds projects, evidence references, employee submission, assigned reporting-manager review, feedback and SQL notifications. See [SKILL_REVIEWS.md](SKILL_REVIEWS.md) for current status rules and security boundaries. The draft-only behavior described below is the original phase and is now extended by this flow.

