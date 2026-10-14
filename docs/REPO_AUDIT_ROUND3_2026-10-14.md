# Follow-up audit 3 — 14 October 2026

Audited the current local workspace, including the preceding unpushed fixes. Two further issues are confirmed; AI task handling has two distinct reproductions. This round does not change application code or production data.

## 1. [P2] AI task tracking mishandles clarification answers and explicit task changes

Location: `apps/api/src/modules/ai/context.ts:170–186`; task classification consumed by AssistantService.

Clarification reproduction through the actual AssistantService:

1. User: “Give me a 10-question quiz”. Synthetic provider: “Which topic should the quiz cover?”
2. User: “Networking”. Provider returns a valid ten-question practice_quiz.
3. Server rejects it: “This response type was not requested.”

The second message lacks both a quiz keyword and the hardcoded refinement prefix. refinedTaskSettings reclassifies it as an ordinary answer, discarding the still-pending quiz intent. The same shape affects natural short answers to topic/level clarification.

A second reproduction uses actual ConversationMemory: after a quiz request, “Make it a learning plan instead” remains classified as quiz with questionCount=10. The prefix preserves the old quiz anchor, whose keyword takes precedence over the explicit new learning-plan intent.

The earlier compaction fix correctly retains task contracts, but retaining a contract alone does not distinguish a clarification answer from a new task. Neither reproduction grants access or changes saved claims.

Repair direction: represent pending clarification/active intent explicitly and recognize explicit task switches before generic refinements. Preserve quiz count across a topic/level answer, while allowing an explicit new plan/profile/request task to reset the contract. Cover real AssistantService multi-turn delivery, not only settings with quiz keywords repeated in each message.

## 2. [P2] A failed saved-draft read leaves an editable blank form without a retry action

Locations: `apps/web/src/capabilities/CapabilityComposer.tsx:495–511`; retry control at line 1563; readiness guard around line 246.

The bootstrap marks personalReady=true after options load, before reading the requested saved submission. If the saved GET fails, catch sets a generic error and finally clears initializing, but personalReady remains true. The error says “Please try again”; the Try again button is rendered only when personalReady is false. The form is no longer marked working and retains its initial empty skills/placeholder certificate rather than the saved draft.

Reproduction executed the actual bootstrap function with successful availability/options responses and a failing saved-submission GET. Result: initializing=false, personalReady=true, recovery=false, skills=[], retryButtonVisible=false, formWorking=false.

The database revision check prevents this blank state from silently replacing the existing saved submission. The confirmed bug is the misleading ready/editable form and missing load-retry action, not confirmed persisted data loss. Users can close/reopen, or provoke a failed save before the separate recovery action appears; neither is a clear load retry.

Repair direction: complete readiness only after both personal options and the requested saved draft load successfully. Keep a distinct bootstrap error/retry state and disable editing/saving until restoration completes. Test failed GET, locked saved submission, successful retry and cancellation on close.

## Reproduction artifacts and limits

- `.local/repo-audit-round3.ts` and `.local/repo-audit-round3-results.json`.
- Actual AssistantService with a deterministic synthetic provider, actual ConversationMemory and executed source of the composer bootstrap.
- These cases are additional to the preceding passing tests. No real-provider hosted conversation, browser production mutation, push or deployment was performed in this round.

## Local repairs

The reported cases were repaired after the user requested fixes. Server-owned memory records whether the preceding plain reply requested clarification. A short clarification answer retains the active task/count; recognized explicit task requests and switches take precedence over generic refinements. Both message-array and server-owned conversation paths use the same transition function. Artifact delivery clears clarification state, and access-policy reset clears retained intent. This is bounded task routing, not a universal natural-language intent classifier or an authorization decision.

Composer bootstrap now starts unready, clears the previous error, and enables the form only after personal options and the requested saved submission are successfully loaded. Failed/locked reads keep the form disabled and expose Try again. A successful retry restores the draft before enabling editing; cancellation cannot mark the form ready. Locked-state errors preserve their actionable message.

Validation: the original synthetic-provider/actual-handler repro now accepts the topic quiz, selects a draft for the explicit learning-plan switch, and leaves failed draft loading locked with its retry visible. Full suite passed: 6 architecture + 321 API + 220 web = 547 tests. Regression tests cover actual AssistantService quiz delivery, count retention, explicit switches, policy reset, failed and locked bootstrap, successful retry and cancellation. Repairs remain local and unpushed; production acceptance is pending release.
