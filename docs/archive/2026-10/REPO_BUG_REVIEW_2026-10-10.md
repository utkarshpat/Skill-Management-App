# Repository bug review — 10 October 2026

Reviewed the current main checkout plus the uncommitted employee-directory changes. Areas traced: identity/SSO, effective access and actor projections, organisation, skills and reviews, certification renewal/recommendations/uploads, learning/recommendations/practice, workflows, notifications and frontend async state. This is source review with isolated reproductions, not authenticated production acceptance. No application fixes or live database writes were performed during this review.

## 1. P1 — Production skill and certification recommendation sends are blocked

Locations: `apps/api/src/modules/skills/certification-recommendation-routes.ts:44,113`; `apps/api/src/modules/recommendations/routes.ts:42,65`; `apps/api/src/modules/access/sql-access-store.ts:98,138`; `database/migrations/048_actor_access_context.sql:19`.

Both route families use `readActorAccess`, which selects `actorSnapshot` in SqlAccessStore. Its SQL result contains only the actor and the decoder deliberately sets reporting to undefined. The SEND helpers require the recipient in state.people and an exact reporting edge in state.reporting. Consequently an authorized manager who has selected an eligible recipient gets HTTP 403 before either SQL send procedure executes. Full-snapshot/local fixtures pass, masking the deployed adapter mismatch.

Reproduced both actual HTTP endpoints with an actorSnapshot shaped like SQL: `/api/certification-recommendations/send` returns 403, `/api/recommendations` returns 403 with INACTIVE_RECIPIENT, send-backend call count is zero. Both helpers allow the same pair with the complete authorized fixture.

Fix direction: obtain a current, narrowly scoped recipient relationship decision for SEND (or use an internal full relationship snapshot where necessary), while retaining independent SQL enforcement. Do not weaken the checks or infer recipient authority from hasDirectReports.

## 2. P1 — Renewal SAVE and renewal linking are separate commits

Locations: `apps/api/src/modules/skills/sql-certification-store.ts:69–79`; `database/migrations/057_certification_expiry_reminders.sql:16`; `apps/web/src/certifications/CertificationDialog.tsx:300`.

change() first commits CertificationWorkspace SAVE, then calls LinkCertificationRenewal on a separate connection/transaction. If linking fails because a renewal already exists, the source is unavailable, or the second call fails, the endpoint returns an error despite a saved unlinked draft/revision increment. The dialog updates its revision only on successful onSave resolution, so retry uses the old revision and conflicts. For direct SAVE_SUBMIT with renewedFromId, the first call submits the record; the linker then rejects it because it requires DRAFT.

Reproduced the store control flow with an isolated committed first stage and injected second-stage 51010 failure: change() rejects with 409 while the first-stage revision remains incremented. This is failure injection, not a live SQL test; independent procedure transactions also establish the rollback boundary in source.

Fix direction: validate/link the renewal within the same SQL transaction as SAVE and before submission. Preserve the unique active-renewal constraint and review history; return a revision only after the entire operation commits.

## 3. P2 — Failed recommendation refresh leaves stale employee details visible

Locations: `apps/web/src/certifications/CertificationRecommendations.tsx:64–87,273`.

The feed effect retains the previous feed and detail, and its catch only updates error. Rendering maps feed.items even while loading or after a failed request. After access is revoked or reporting changes, a refresh can return 403/409 while the old recipient name, employee code and recommendation reason remain visible and the detail dialog remains usable. Switching Sent/Received also temporarily relabels old records as the opposite direction.

Evidence: direct effect/render control-flow trace; no authenticated browser reproduction performed.

Fix direction: bind displayed data/detail to the successful request's view and current authorization; clear private data on 401/403 and relationship conflicts, and disable stale response actions while rechecking. Preserve user-written unsaved text separately from server-derived private data.

## 4. P2 — Corrupt PDF/DOCX attachments pass certificate validation

Locations: `apps/api/src/modules/skills/evidence.ts:111–123`.

PDF validation only searches the first 1024 bytes for %PDF-. DOCX validation only checks four ZIP magic bytes. Reproduction: the four-byte buffer 50 4b 03 04 is accepted as a DOCX; the text "not a document %PDF-" is accepted as a PDF. Neither is an openable document. These files can satisfy the mandatory certificate attachment check even though the promised PDF/DOCX is invalid. This finding does not claim automatic code execution.

Fix direction: bounded structural validation of PDFs and DOCX ZIP contents, with mandatory OOXML parts and decompression limits. Retain server MIME/size checks and private evidence authorization.

## 5. P2 — Recipient search can silently change or retain the wrong recommendation target

Locations: `apps/web/src/certifications/CertificationRecommendations.tsx:89–113,330–361`.

After each search the effect auto-selects the first result if the previously selected person is absent. During the request it retains the prior people/personId and has no recipient-loading state; Send remains enabled. Searching for employee B while A is selected can therefore send to A before results arrive, or silently switch to a different first result after they arrive without explicit selection. A failed search retains that old selection as well.

Evidence: direct state/send control-flow trace; no real messages were sent.

Fix direction: require explicit recipient selection, display the selected employee clearly, clear invalid selection on query changes, and block sending while recipient discovery is pending or failed.

## 6. P2 — Employee certification recommendations have no discoverable navigation

Locations: `apps/web/src/CapabilityPortfolio.tsx:47`; `apps/web/src/certifications/Certifications.tsx:183–218`.

The real capability portfolio always mounts Certifications with personalOnly. That condition hides the whole certification-view nav, including the only Recommendations button. The recommendations screen still works via the notification URL, but the employee cannot open it from the normal certification page or rediscover historical recommendations once the bounded notification feed no longer includes them.

Evidence: production component composition and route trace.

Fix direction: keep the employee's own portfolio/recommendations navigation visible while hiding only manager queue controls in personalOnly mode. Preserve separate learning and certification recommendations.

## Reproduction and limits

The isolated reproducer is in the ignored local file `apps/api/.local/codex-review-repro-20261010.ts`. Run from apps/api: `node --import tsx --test .local/codex-review-repro-20261010.ts`. Four reproduction checks passed, confirming existing faulty behavior: actor-projection mismatch, actual HTTP send failures, corrupt file acceptance and renewal second-stage partial commit. They are not regression tests that demonstrate fixes. The script mocks SQL connections and performs no live SQL/Blob writes.

Existing tests rely on complete in-memory access snapshots for the recommendation send flows, explaining why normal tests pass despite the deployed actor-only mismatch. The current external employee-directory API/synchronization is an explicitly unimplemented integration, not counted as a defect here.

## Fix implementation (10 October 2026)

All six findings have local code fixes. Sends resolve a full server-only relationship snapshot for resource authorization; compact actor projections remain in use for participant reads, and SQL still enforces the current direct manager policy. Renewals use one outer SQL transaction across save, link and optional submission; the API returns the actual resulting credential revision. No new SQL migration is needed.

Recommendation results are keyed to their request and cleared on refresh/failure; stale details cannot respond. Recipient search clears selection immediately, disables sends while pending/failed, and requires explicit selection. Personal certification navigation includes Recommendations while manager review navigation remains hidden. The My certifications tab no longer remains highlighted alongside Recommendations.

PDFs are parsed for valid readable pages; DOCX uploads require the package content type, office-document relationship and valid document/body XML. ZIP expansion and entry counts are bounded; document parsers run in a worker with a timeout and memory budget. Image compression, the original 5 MB limit, private storage and independent SQL authorization remain enforced. Document structural validation does not constitute malware scanning.

Executable regression coverage includes SQL-shaped actor projection HTTP sends and relationship/inactivity/deny rejection; transactional failure injection at save, link and submit; valid generated PDFs/DOCX and malformed/header-only/truncated/irrelevant documents. Transaction tests mock SQL transport: live restricted-runtime SQL acceptance and authenticated browser UX acceptance are separate deployment checks. The previous ignored BUG reproducer captures pre-fix behavior and is superseded by maintained regression tests.
