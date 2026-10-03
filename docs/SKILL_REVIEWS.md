# Skill claim submission and assigned review

Migration 010 extends existing claims without replacing their IDs or historical audit. Drafts record a claimed proficiency, experience, project contributions and plain-text evidence references. Evidence is referenced rather than uploaded; no URL is fetched or made executable by the application. These inline references belong to the claim, not the future standalone evidence library.

## Lifecycle

| Current state | Action | Next state |
| --- | --- | --- |
| DRAFT, CHANGES_REQUESTED, REJECTED | Owner saves | Same state, new revision |
| DRAFT, CHANGES_REQUESTED, REJECTED | Owner submits | SUBMITTED |
| SUBMITTED with a changed reporting manager | Owner resubmits | SUBMITTED, routed to current manager |
| SUBMITTED | Assigned current manager requests changes | CHANGES_REQUESTED |
| SUBMITTED | Assigned current manager rejects | REJECTED |
| SUBMITTED | Assigned current manager approves | APPROVED |

SUBMITTED and APPROVED claims cannot be edited. Approval records manager-reviewed proficiency, not a certification or learning-test result. Review decisions require feedback. A later proficiency reassessment of an approved claim is deliberately not implemented yet; approvals cannot silently become drafts.

## Authority and concurrency

The verified actor and workspace are server-owned. The owner needs profile.view, skill.claim and published skill.view. Submission resolves the actual direct reporting manager from AccessOrgAssignment, requiring an active reviewer with profile.view and skill.verify. There is no role-name or senior-manager fallback. Missing or unprovisioned routing blocks submission with an actionable error.

skill.verify is a functional grant, currently provisioned with ORGANIZATION scope because persisted configurable scopes support OWN and ORGANIZATION. It never exposes organization-wide claims: SQL additionally requires both the stored reviewer assignment and current direct reporting relationship, an active owner, and a distinct owner/reviewer. Generic resource authorization still rejects review without an assigned claim. Capability discovery uses a separate effective-grant calculation; it cannot approve anything. Manager presets now include this implemented assigned-review right; existing customized roles are preserved and can be amended by Super Admin.

Claims retain their submitted proficiency-definition snapshot. Submission requires the latest published definition, while review uses the submitted snapshot even if the catalogue later changes. Every write holds the workspace transaction lock, checks the expected claim revision and updates claim, audit and addressed notification atomically. Stale writes, replayed decisions, revoked permissions, self-review and cross-workspace requests fail closed. If reporting changes while a claim is pending, the old manager loses queue access and decision authority; the employee can reroute it to the current eligible manager.

## UI and AI

My skills shows status, a paged claim-details dialog, editable returned claims and explicit submission confirmation. Skill reviews appears only with effective review permission and shows a paginated assigned queue. Decisions require review and confirmation in a dialog. Long read-only text is split into small pages; forms keep paged desktop layouts and mobile scrolling. Notifications merge the actor's access notices and SQL claim events; previous reviewers lose visibility when reporting or permissions change.

The provider-independent assigned_skill_reviews AI tool exposes a compact, bounded queue only after current permission checks. Own-skills output reports actual claim status and distinguishes manager-reviewed from unverified entries. Guidance describes the implemented submission and review flows. AI still prepares and guides; writes happen only through user-reviewed application actions. Learning quizzes remain separate.

The frontend waits up to 90 seconds for hosted requests, reports database wake-up during demo unlock, and gives a useful timeout/retry message. Writes are never automatically replayed. Cold database startup can still require a retry; this change improves patience and messaging rather than guaranteeing SQL readiness.

## Verification and deployment

Run npm run typecheck, npm test, npm run build and npm run architecture:check. Run npm run db:migrate -w apps/api before deploying API code that calls the new procedures. The schema is backward-compatible with old draft-only clients during rollout. Run npm run test:reviews -w apps/api for rollback-only SQL checks of submission, queue assignment, returned/resubmitted claims, approval, audit, evidence, notifications, stale versions, self/foreign review, revocation and reporting changes. These checks use temporary transaction fixtures and leave business records unchanged. Interactive acceptance runs against the deployed HTTPS app in the user's Chrome.

Rollback deploys may read new statuses without understanding them; after real submissions exist, roll forward rather than reverting to a draft-only client. Never drop migration 010 or its data to undo a UI deployment.
