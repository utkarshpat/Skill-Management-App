# Repository audit — 14 October 2026

Current-status update, 15 October 2026: runtime `e0fa9a3` is deployed and the [production E2E record](PRODUCTION_E2E_2026-10-15.md) documents fresh acceptance and limits. The [current handover](HANDOVER.md#current-release-and-production-acceptance-15-october-2026) supersedes older local/pending statements for the covered features. The dated findings below remain historical evidence; no blanket go-live or issuer verification is implied.

Audited revision: `52bfeedc3578f75e43c046da1d775b3fa401c596`.

This audit found six reproducible defects and one confirmed partial flow. No application fixes, database mutations, commits, pushes or deployments were performed during this audit. Prior production acceptance is documented separately in `EVIDENCE_PRODUCTION_ACCEPTANCE_2026-10-14.md`.

## Findings

### 1. [P2] Response-body reads lose cancellation after headers arrive

Location: `apps/web/src/inflight-reads.ts:64–69` (headers marked settled at line 44).

The shared GET wrapper substitutes its own transport signal, then removes each caller's abort listener when resolving the response headers. The response body can still be streaming at this point. A later caller abort therefore neither aborts transport nor interrupts consumption of that response body.

Reproduction: return a Response backed by a hanging ReadableStream, await the wrapper's response, start consuming its body, then abort the caller signal. The transport signal remains un-aborted and the body read remains pending. This can leave file viewers/body reads active after cancellation and defeats caller deadlines during body transfer.

Fix direction: retain cancellation for each consumer's body lifetime without allowing one consumer to cancel other active consumers. Cover cancellation after headers, shared consumers and normal streaming completion.

### 2. [P2] A second quiz follow-up loses the quiz task context

Location: `apps/api/src/modules/ai/assistant.ts:695–700`.

Task classification uses only the latest message plus the immediately preceding user message. After “Give me a 10-question quiz on networking” → “Make it 6” → “Make it shorter”, the two messages supplied to taskSettings contain no quiz intent. The response contract switches to an ordinary answer.

Reproduction through AssistantService with a synthetic provider: a valid six-question quiz returned on the second follow-up is rejected with “This response type was not requested.” A ten-question response is also rejected. This finding is loss of task context, not acceptance of an incorrect quiz count.

Fix direction: carry the resolved task and its constraints through relevant follow-ups; allow explicit task changes. Add a multi-turn regression test, including requested question-count changes.

### 3. [P2] Learning completion's Add skill action searches for a UUID

Locations: `apps/web/src/LearningCompletionNextSteps.tsx:111–112`; `apps/web/src/MySkills.tsx:252–255, 268–313`.

The completion action puts plan.skillId into the `skill` query parameter. MySkills treats that parameter as a name, searches with the UUID and attempts to match skill.name against it. It also opens the legacy wizard via edit() instead of the unified intake used by the normal Add skill button. “Upload earned certificate” uses the same legacy add route.

Reproduction: execute the actual deep-link handler and edit function with a canonical skill UUID. The calls setSearch(UUID), setSuggestedSkillName(UUID) and setDraft(emptyDraft); the unified composer is never opened. A UUID cannot match the expected catalogue name, so the intended skill is not preselected.

Fix direction: send these actions through unified intake; resolve canonical IDs as IDs and explicitly distinguish certificate-first entry. Preserve name-based suggestions where they are intentionally supported.

### 4. [P2] Legacy skill editor still requires an optional experience description

Location: `apps/web/src/MySkills.tsx:405–408`; backend contrast: `apps/api/src/modules/skills/claims.ts:225–226`.

The legacy save path rejects a blank description, while the API and unified intake allow it. This path remains reachable for standalone claims without activeSubmissionId and through the add deep link above. Users cannot save or resubmit otherwise valid records until they fill a field that was made optional.

Reproduction: execute the frontend save validation with a valid skill/rank/date and an empty description. It reports “Describe your experience using up to 2,000 characters.” Passing the same draft to claimChange succeeds.

Fix direction: align the legacy save validation with the canonical API contract, or migrate supported legacy editing through unified intake without losing existing claims.

### 5. [P2] Authorized Analytics destinations do not generate an AI navigation action

Locations: `apps/web/src/assistant-actions.ts:5–25`; server discovery: `apps/api/src/modules/ai/capabilities.ts:14`.

The server offers `/business` as Analytics when effective access permits it, but the frontend destination allowlist omits `/business`. The navigation-action helper consequently filters out that authorized page.

Reproduction: assistantNavigationTargets with an Analytics markdown link, a `/business` source and an authorized Analytics page returns an empty list. This specifically removes the dedicated navigation action; it does not establish that every inline markdown link is unclickable.

Fix direction: recognize the implemented Analytics route while continuing to filter actions against server-provided authorized pages. Do not infer Analytics permission from an admin/manager role name.

### 6. [P2] Large CSV exports exceed the current hosting response limit

Locations: `apps/api/src/modules/business/routes.ts:233–259`; advertised export size: `apps/web/src/business/BusinessOperations.tsx:1655`.

Analytics advertises all matching rows up to 50,000, but the export route builds the whole CSV/XLSX and sends a buffered body. A 50,000-row skills CSV fixture containing a 200-character description per row is 12,628,190 bytes. That exceeds Vercel's documented 4.5 MB function response payload limit: [Vercel Functions limits](https://vercel.com/docs/functions/limitations).

The payload size and buffered route are reproduced locally. A large production export was not executed and no production rows were created for this test. This finding applies to the current Vercel host; it does not assert the same limit on future organization hosting, or that XLSX always exceeds the limit.

Fix direction: stream exports using a supported response mechanism, or generate a scoped downloadable artifact with fresh access checks. Preserve the current scope recheck and complete-export guarantee.

## Confirmed partial flow

### Ordinary evidence → certificate is unavailable in the legacy editor

Location: `apps/web/src/SkillClaimWizard.tsx:470–475`; conditional action: `apps/web/src/ClaimEvidence.tsx:96`.

The unified composer supplies onUseAsCertificate, but the reachable legacy wizard does not. Its editable ordinary evidence uploader therefore never offers the explicit “Use as certificate” action. This was verified by component wiring; this audit did not run a fresh browser reproduction for a legacy record. Prior production evidence promotion acceptance covered the unified composer only.

Fix direction: support explicit promotion for eligible legacy records while retaining the certificate 5 MB original-file rule and user confirmation. Ordinary evidence must not silently become a certification.

## Validation and coverage

- Full `npm test`: 6 architecture + 316 API + 212 web tests passed (534 total, zero failures).
- `npm run typecheck`: API and web passed, including test TypeScript configurations.
- Targeted reproductions: actual InflightReads streaming cancellation; synthetic-provider AssistantService quiz conversation; executed MySkills deep-link/save handlers; actual claimChange validation; assistant navigation helper; actual businessCsv generator.
- Local ignored artifacts: `.local/repo-audit-repro.ts`, `.local/repo-audit-extra.ts`, their JSON results and `.local/repo-audit-tests-20261014.log`.
- Read/search coverage included access/effective-access discovery and execution, people/organization administration, uploads and file viewers, skill/certificate intake and review, learning, AI contracts/tools, workflows, notifications, Analytics querying/export and related SQL boundaries.
- The approved Access Management baseline was used when assessing authorization. No new authorization bypass was confirmed in the inspected paths. This is not exhaustive security assurance or a claim that all race conditions are absent.

Suggested repair order: deep-link/unified editor consistency (3, 4 and partial flow), response-body cancellation (1), AI context and navigation (2, 5), then large-export delivery (6). Re-run focused regressions and hosted acceptance for changed flows before pushing a repair.

## Local repairs completed

All six findings and the legacy promotion flow above were addressed after the user requested repairs. These are local changes, not a deployed acceptance claim.

- Learning/add deep links open unified intake. Canonical IDs resolve against authorized published catalogue results, including renamed skills and pagination; a same-name foreign ID is never substituted. Certificate entry opens certificate-first intake.
- The legacy editor permits an empty description while retaining the 2,000-character bound. Its evidence promotion transfers the current draft and a selected file into unified intake with a linked skill; files above the certificate 5 MB limit leave the legacy form/evidence unchanged.
- GET body cancellation stays attached after headers. Cancelling one reader does not stop other active readers; cancelling the final reader stops transport.
- Quiz task classification follows contiguous user refinements, retains the quiz type, uses the latest revised count and resets on a new task.
- Analytics navigation recognizes `/business` only when the canonical server discovery includes that exact page. Arbitrary scope/person query links remain filtered out.
- Both ordinary Analytics and people-matching CSV/XLSX delivery use the existing private streaming helper after access/scope rechecks. The global error handler delegates failures after headers instead of attempting a second JSON response.

Validation: 6 architecture + 317 API + 216 web tests passed (539 total); complete API/web build and typecheck passed; diff whitespace checks passed. The large-export HTTP regression verified the exact complete 50,000-row CSV bytes, chunked delivery without Content-Length, and rejection after export revocation. Streaming cancellation, successive quiz refinements, authorized/unauthorized Analytics links and canonical catalogue resolution have regression coverage. The existing legacy save validation was also re-executed with an empty description and now allows it, matching the backend.

Build and build-cache tests share the API output directory, so final verification was run sequentially. One initial parallel verification collided on that directory; the sequential run passed. No production browser E2E, deployment, database migration or push was performed for these repairs. Hosted streaming and the updated form interactions still need acceptance after a separately authorized release.
