# Fresh bug review — 10 October 2026, round 3

Four issues were confirmed in the audit, followed by a fifth user-reported quiz-count bug. All five now have local implementation fixes. The original reproductions below describe the pre-fix behavior. No migrations were installed and no changes were pushed/deployed. Existing changes and the user's refinement notes are preserved.

## 1. [P1] Recheck notification access before delivering the combined feed

Location: `apps/api/src/modules/identity/routes.ts:180–210`.

`/api/notifications` reads actor access once, starts all feed sources and sends their combined result without a final actor/permission/revision check. A person can be deactivated or receive a relevant DENY while those asynchronous reads are finishing, and the request still delivers previously authorized private notification content. Individual sources throwing `AccessError(401/403)` correctly withhold the feed; that protection does not cover a source that obtained its authorized snapshot before the access change and delivers it afterward.

Reproduction: the real HTTP app admits a synthetic active actor, an asynchronous workflow source obtains synthetic notification data, and the actor is deactivated before that source returns. The first response is **200 with the notification**, with only **one access read**; the immediately following request is **403**. No real person's content is used. This demonstrates a response-time authorization gap, not a claim that SQL permits a new unauthorized read after deactivation.

Fix direction: re-read canonical access before `res.json(feed)`, require the current active actor and profile prerequisites, and withhold results when the relevant access/revision changed. Preserve individual source fail-closed handling and transient partial-feed reporting. Do not cache access or relax source SQL checks.

## 2. [P2] Keep internal learning prompts within the assistant contract

Locations: `apps/api/src/modules/learning/planner.ts:87–88`, `apps/api/src/modules/learning/recovery.ts:167`, `apps/api/src/server.ts:99–104`; enforced limit in `apps/api/src/modules/ai/assistant.ts:73`.

The production learning generator puts the whole server-built prompt into one user message. The public assistant accepts at most 2,000 characters per user message. Planner intake allows a 300-character goal, 500-character experience, 500-character feedback and up to 12 previous 160-character steps; all are serialized together with instructions. Valid refinement therefore fails before any provider request. JSON escaping also affects the recovery advice prompt's eight task titles.

Reproduction with the real services and the production `assistant.chat` call shape:

- Valid 12-day planner refinement: **4,177-character prompt → HTTP-style AccessError 400**, zero model calls.
- Valid eight-task recovery with quoted 160-character titles: **2,003-character prompt → AccessError 400**, zero model calls.

The existing planner/recovery tests inject a generator directly and do not exercise this assistant boundary.

Fix direction: use a bounded internal learning-generation adapter or correctly chunk trusted instructions and untrusted input within the assistant's per-message and total limits. Preserve input validation, explicit task intent, cancellation, current permission rechecks and public chat limits. Cover escaping and maximum valid refinement inputs through the actual adapter.

## 3. [P2] Reconcile uncertain manual learning-plan creates

Locations: `apps/web/src/Learning.tsx:126–148`, `apps/web/src/Learning.tsx:844–874`, and `database/migrations/016_learning_skill_mapping.sql:15`.

AI planner confirmation uses `LearningPlanCreateAttempt` to retain the operation and reconcile an uncertain save through an own-plan read. The manual New plan flow calls `change(CREATE)` directly. A committed save with a lost response leaves the form open without refreshing or reconciling the saved plan. Clicking Create again resends the same ID and gets 409 from SQL; closing and starting again generates a new ID while the page still shows the old empty snapshot, permitting duplicate plans/tasks.

Reproduction:

1. Restricted-runtime development SQL rollback fixture creates a synthetic plan, verifies it in `ReadOwnLearningPlans`, then retries the exact same CREATE. SQL throws **51009**, mapped to **409** by `SqlLearningStore`.
2. Isolated browser fixture uses the real `Learning` component and intercepts all API calls. The first POST stores the synthetic plan then simulates loss of its response. The second click sends another POST and gets 409. **No reconciliation GET occurs**; saved-plan count remains one while the page still shows zero.
3. Closing the form and entering the identical plan again produces **two saved synthetic plans**. All browser persistence is fixture memory; no real APIs are called.

The SQL fixture rolled back all plans/audit and verified unchanged workspace revision and migration version.

Fix direction: give manual creates the same stable, immutable intent and own-plan reconciliation protocol as planner creates, including focus/skill fields. Block retransmission while the committed status is unknown. An uncertain operation should not silently become a fresh intent when editing/reopening. Preserve transactional SQL ownership, validation and revisions.

## 4. [P2] Synchronize certification recommendation direction with navigation

Location: `apps/web/src/certifications/CertificationRecommendations.tsx:55–58` and `:87–118`.

The component initializes `view` from `direction`/`sentOnly` only once. Later query navigation changes `focused` and triggers a reload while retaining the previous local direction. For a manager viewing Sent in their personal certification recommendations, an incoming certification notification navigates to the same page with the received record ID and no `direction=sent`. The component queries that received ID with `view=sent`, and the correctly isolated backend returns no items. The UI falsely reports “This recommendation is unavailable.”

Reproduction: isolated browser fixture with the real component, synthetic received/sent records and query navigation. Sent is selected; the incoming link changes the record ID, but the request remains `view=sent&id=<received-id>`. The record exists and is returned when Received is selected. The reciprocal query-direction change also reproduces the state mismatch in the component fixture. Skill recommendations already synchronize direction changes with an effect.

Fix direction: derive direction from the current route or synchronize `sentOnly` and query direction explicitly, resetting pagination and closing/rechecking the previous record/response operation on navigation. Preserve server participant isolation; do not search both directions to bypass the mismatch.

## Reproduction artifacts and validation

Ignored local files, retained for a follow-up fix:

- `apps/api/.local/fresh-audit-round3-unit.ts`: real planner/recovery → assistant adapter and notification HTTP reproductions. All expected fault assertions passed.
- `apps/api/.local/fresh-audit-round3-sql.ts`: restricted-runtime exact CREATE retry in a development-only rollback transaction; cleanup verified.
- `apps/web/.local/round3-audit.html` / `round3-audit.tsx`: real components, synthetic in-memory fetch adapter; all API calls intercepted before network I/O. Verified direction mismatch, uncertain save, failed exact retry and duplicate recreation.
- `apps/web/.local/round3-recommendation-direction.png` / `round3-manual-plan-retry.png`: browser evidence, synthetic content only.

Existing focused tests for planner, recovery, workflow AI and notification-feed behavior: **15 passed**. The audit report passes Prettier and `git diff --check` reports no whitespace errors. The full suite was not rerun because application implementation was unchanged in this audit.

Reproduce the two API checks from `apps/api`:

```powershell
node --import tsx .local/fresh-audit-round3-unit.ts
node --env-file-if-exists=.env --import tsx .local/fresh-audit-round3-sql.ts
```

The reproduction scripts assert current faulty behavior; they are not regression tests for a fix. The SQL script refuses databases whose name does not end in `-dev` (or equal `dev`). No migration or data changes persist.

## Local fixes and verification

- Notifications capture the initial effective-access projection and re-read canonical actor access before delivery. Deactivation, DENY changes (including skill access without a revision change), and access-revision changes discard the feed. Source failures retain existing partial-feed handling.
- Internal planner, practice and recovery generation pass a server-selected output intent through bounded context fragments. Public chat limits remain unchanged. Recovery advice retains plain-text output rather than accidentally activating draft tools.
- Manual learning creation now shares the planner's immutable confirmation and own-plan reconciliation helper, retaining all 60 permitted tasks and optional skill focus. Failed reads block another write. Uncertain confirmations survive closing/reopening the form, and editing/navigation remains locked until the original confirmation is resolved. Definitive rejection permits correction. This is component-session recovery; reload or leaving the learning page still requires checking Calendar before starting another plan.
- Certification recommendation direction derives from the current URL. Sent/Received navigation writes the direction, incoming links switch correctly without remounting, and focused lookups use page 1.
- Quiz task settings carry the requested question count (default 10, bounded to 1–20) into output validation. A 10-question request returning 3 is rejected with 502 instead of displaying the partial quiz. Matching counts and count-changing follow-ups pass.

Validation: full test suite passed (architecture 6, API 274, web 167; **447 total**), production build, application/test typechecks, architecture boundaries and generated-document checks passed. Added regression cases cover actual assistant count validation/internal message boundaries, notification response-time revocation and manual save recovery. Browser checks using the real components and intercepted synthetic APIs verified Sent → incoming Received navigation and one POST followed by reconciliation GET, modal closure and Calendar display after a lost create response. No real learning or recommendation records were written.
