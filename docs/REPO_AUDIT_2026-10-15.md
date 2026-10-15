# Follow-up audit — 15 October 2026

Current-status update, 15 October 2026: runtime `e0fa9a3` is deployed and the [production E2E record](PRODUCTION_E2E_2026-10-15.md) documents fresh acceptance and limits. The [current handover](HANDOVER.md#current-release-and-production-acceptance-15-october-2026) supersedes older local/pending statements for the covered features. The dated findings below remain historical evidence; no blanket go-live or issuer verification is implied.

The preceding unpushed repairs remain intact. This audit confirms two additional UI issues. Application code, production records, deployment and access grants were not changed.

## 1. [P2] Unified intake does not warn before unsaved entries are lost on page unload

Location: `apps/web/src/capabilities/CapabilityComposer.tsx:1048–1052` and its component effects. Contrast: `apps/web/src/certifications/CertificationDialog.tsx:375–387`.

The unified form keeps edits and selected files in component state until the user explicitly saves. Its close handler checks dirty.current and opens the discard confirmation, but there is no beforeunload guard. Browser refresh or tab/window closure bypasses that handler and loses the unsaved entries/selected files. The older certificate dialog has an unload guard, making this a regression in the unified replacement flow.

Confirmation: executed the actual dirty-form close handler, which requests discard confirmation; inspected the composer and other mounted shared components for unload protection. The composer has none. This audit did not automate a destructive browser refresh or claim that already saved drafts/files are lost. SPA route departure needs its own handling; beforeunload alone does not cover every navigation type.

Repair direction: warn on unload while dirty, uploading or awaiting uncertain-save reconciliation. Keep the existing explicit discard path. If route changes can unmount the modal, add appropriate route-departure protection as well. Do not claim the form has been saved merely because a warning was shown.

## 2. [P3] A completed request opened from a stale manager queue still says awaiting decision

Locations: `apps/web/src/capabilities/CapabilityReview.tsx:161, 233`; SQL semantics: `database/migrations/080_approved_renewal_portfolio.sql:281–304`.

Scenario: a request is visible in a manager's first tab, then the same manager finishes its review in a second tab. Opening the first tab's stale queue entry fetches the completed REVIEWED submission. SQL preserves item needsReview as the historical distinction between newly reviewed and reused records; it does not mean the item is still pending once the bundle is reviewed.

CapabilityReview counts every needsReview item and displays the count whenever readOnly=false, without checking the submission state. A completed two-item request therefore displays “2 awaiting decision” even though canDecide=false and its items are approved. The false label is reachable through the manager queue's normal default readOnly=false path during this cross-tab race.

Reproduction executed the actual row/count expressions with a REVIEWED bundle containing two approved needsReview=true items. Result: pendingCount=2, canDecide=false, label="2 awaiting decision". SQL DECIDE changes the bundle status and records decisions while retaining needs_review. Approval controls and backend checks still prevent another decision; this is a misleading summary, not a permission bypass or duplicate approval.

Repair direction: derive outstanding count from both bundle state and item eligibility. Completed bundles should show their final state/outcomes rather than a pending count. Cover stale queue opens, mixed outcomes and genuinely submitted requests.

## Artifacts and limits

Ignored local fixture: `.local/repo-audit-round4.ts`; result JSON: `.local/repo-audit-round4-results.json`. The fixture executes current source expressions. Unload protection is confirmed by source inspection; no browser E2E or production mutation was performed. No further application fixes were made in this audit.

## Repairs for the consolidated audit-fix push

The user subsequently requested fixes and a push. Unified intake now installs a native beforeunload warning while dirty, actively saving/uploading, or awaiting uncertain-save reconciliation, and removes the listener when the form closes. This protects refresh/tab closure without claiming that entries are saved. The existing explicit modal discard flow remains. Browser-controlled warnings depend on browser support/user activation; this is not a router-level SPA navigation blocker.

The review summary now counts pending items only when the request is SUBMITTED. REVIEWED and LINKED bundles display their actual completed state and retain zero outstanding decisions, including when opened from a stale manager queue. This changes presentation only; API/SQL authority and transitions are unchanged.

Added regression coverage for dirty/clean unload events and submitted/completed/read-only review summaries. This consolidated push also includes the preceding audit repairs documented in the 14 October reports. No database migration is required. Hosted form/browser and hosting-specific streaming acceptance remain separate release checks.

Consolidated verification: 6 architecture + 321 API + 222 web tests passed (549 total); API/web build and typecheck passed; changed files passed formatting and whitespace checks. Two unrelated, unchanged capability components have pre-existing formatting warnings and were not reformatted as part of these repairs.
