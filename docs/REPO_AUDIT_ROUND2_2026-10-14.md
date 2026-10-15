# Follow-up audit — 14 October 2026

Current-status update, 15 October 2026: runtime `e0fa9a3` is deployed and the [production E2E record](PRODUCTION_E2E_2026-10-15.md) documents fresh acceptance and limits. The [current handover](HANDOVER.md#current-release-and-production-acceptance-15-october-2026) supersedes older local/pending statements for the covered features. The dated findings below remain historical evidence; no blanket go-live or issuer verification is implied.

Audited the local workspace including the previous unpushed repairs. Three additional defects are confirmed. This audit added only a report and ignored local repro artifacts; no further application fix, push, deployment or production mutation was performed.

## 1. [P2] Recovery can show a replacement file while retaining the older stored certificate

Locations: `apps/web/src/capabilities/CapabilityComposer.tsx:346–363`, upload guards at lines 742 and 829.

Scenario: an incomplete draft already has staged file A. The employee chooses replacement B, updates details, and saves the incomplete draft. The details save succeeds but uploading B fails before committing. Loading the saved draft calls sync(value, true).

That function retains the local File B while setting uploaded/staged to true whenever any staged file exists for that certificate ID. It does not identify whether the server file is B. FileCard previews the local File first; both save paths skip files marked uploaded. The employee therefore sees B but a subsequent save can keep A. The current SQL INTAKE updates intake_json without removing the existing staged file, and SAVE transfers the active staged file into the materialized credential (`database/migrations/080_approved_renewal_portfolio.sql:204–209, 238–243`).

Reproduction executed the actual sync function with local `NEW-certificate.pdf` and saved staged metadata for `OLD-certificate.pdf`. Result: previewFile=NEW, serverFile=OLD, uploaded=true, staged=true, willUpload=false.

Repair direction: restoring a saved snapshot must either discard the local replacement and show the exact stored file, or preserve the replacement as pending with uploaded=false. Never use certificate-ID existence alone as proof that a local replacement was uploaded. Test failed replacement, uncertain committed replacement and first upload separately.

## 2. [P2] AI autofill is unavailable for a reopened saved certificate file

Locations: `apps/web/src/capabilities/CapabilityComposer.tsx:571–572, 1167`; stored-file loading at lines 88–90 and sync at lines 346–363.

Reopening an incomplete draft restores staged metadata and marks uploaded=true, but there is no browser File. The file hook provides a preview URL and metadata; it does not populate cert.file. The AI button is disabled when !c.file and the autofill handler returns immediately for the same condition. A previously uploaded certificate can be previewed but cannot be autofilled unless the employee reselects it from disk. Materialized saved certificates have the same local-File dependency.

Reproduction executed the actual restoration function with a saved staged file and no local File: uploaded=true, staged=true, file absent, autofill guard returns. The button's explicit !c.file condition independently confirms the blocked action.

Repair direction: on explicit AI autofill, fetch the currently authorized stored file as bytes/File, or expose a server autofill path that rechecks exact owner/file access. Preserve explicit user initiation and the certificate size/type constraints.

## 3. [P2] Compacted AI history can resurrect an unrelated older quiz

Locations: `apps/api/src/modules/ai/context.ts:60–70, 97–101, 146–158`.

The previous repair follows a contiguous refinement chain correctly while its original task remains in recent turns. ConversationMemory eventually combines several older user requests into one synthetic user message. conversationTaskSettings then treats that combined excerpt as the task anchor. A keyword from an unrelated old task can override the currently refined task.

Reproduction used the actual ConversationMemory prepare/commit cycle and conversationTaskSettings:

1. Give me a 10-question quiz on networking → quiz, count 10.
2. Explain HTTP caching in plain language → answer.
3. Make it shorter → answer.
4. Make it even shorter → answer.
5. Make it shorter → incorrectly quiz, count 10, after compaction.

This establishes incorrect task instructions/output-contract classification; it does not claim a real provider returned a quiz during a hosted session.

Repair direction: retain the resolved task contract independently of mixed historical excerpts, or retain a specifically identified active task/refinement anchor. New explicit tasks must reset it. Task memory remains untrusted context and cannot affect authorization. Cover actual memory compaction in addition to direct messages-array tests.

## Reproduction and limits

Local repro: `.local/repo-audit-round2.ts`; output: `.local/repo-audit-round2-results.json`. The fixture runs actual source code for draft restoration and actual AI memory/classification classes. No synthetic production records were created. These new cases were not covered by the preceding 539 passing tests; those results do not establish their correctness. Previous unpushed repairs remain intact.

## Repairs

After the user requested fixes, recovery now restores only the server snapshot and clears unconfirmed local files. A restored staged file is shown from its stored metadata/bytes; replacing it requires an explicit new selection. Missing staged files remain un-uploaded.

Recovery also remounts file readers to fetch fresh metadata/bytes even when the certificate ID and endpoint are unchanged. This handles an uncertain replacement that actually committed while its response was lost, rather than leaving an older preview cached in the mounted reader.

Explicit AI autofill accepts either a local selection or an uploaded certificate. Stored files are read through the existing exact authenticated staged/materialized endpoints, with cancellation, byte-length and 5 MB checks before the ordinary autofill request. No new file-access grants or automatic AI calls were introduced.

Server-owned conversation memory now retains its resolved task contract separately from historical excerpts, including across durable JSON restoration. Compaction cannot reclassify the active answer using a previous quiz excerpt. Explicit new tasks and access-policy changes reset the contract; contiguous refinements retain the task and latest quiz count. Older sessions without this optional field derive it from their recent turns, excluding mixed excerpts. The contract controls output type/budget only, not tool authorization. No schema migration is needed.

Regression coverage includes failed replacement recovery, missing staged files, local-file precedence, both stored-file routes, denied/oversized/incomplete/cancelled reads, actual memory compaction, durable restore, policy reset, repeated quiz-count refinements and AssistantService provider output budgets.

Validation: full suite passed (6 architecture + 320 API + 219 web = 545 tests); API/web build and typecheck passed. Repairs remain local and unpushed. Production browser acceptance remains a release step; no production data or database schema was changed.
