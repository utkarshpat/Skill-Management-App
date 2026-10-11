# Access administration bug fixes — 11 October 2026

This review covers the current People & access administration, its preview/save lifecycle and person-filtered access history. It is not a claim that the entire repository or real Microsoft SSO integration is bug-free.

## Confirmed fixes

- Failed configuration reads clear privileged cached data and previews. An initial failed read offers an explicit retry instead of displaying an indefinite loading message.
- Confirmed writes dispatch business/access invalidation events before the follow-up context read. A context refresh failure is reported as a saved change with failed refresh; privileged configuration is cleared.
- Changing selection or a form value invalidates an outstanding preview. Aborted responses cannot reopen the confirmation dialog. Administration controls are disabled while a preview or save is in flight.
- Revision conflicts reload configuration while retaining the user's draft baseline value. A new explicit preview is required before execution.
- People and organization shortcuts use the implemented `view` query parameter.
- Migration 068 includes business responsibility/membership subjects in person-filtered audit history. It matches both the previous and new subject during reassignment, accepts the stored camelCase/snake_case snapshot shapes and resolves the subject name inside the same account. Existing authorization, detail redaction, revision snapshot and exclusive pagination checks remain intact. Local history uses the same subject rules.
- A save whose response is lost retains its assignment ID for the next explicit preview. Retrying does not generate a second assignment ID. This is reconciliation through the existing revision/preview workflow, not a new server-side idempotency contract.
- Selecting an existing project or membership clears the previous draft's reason/selection state rather than carrying it into another change.

## Verification

- Regression harness executes the actual transformed administration component with controlled hook state and delayed HTTP responses. It covers late preview rejection, revision reload, committed-write invalidation, denied-data clearing, initial-load recovery and retained IDs after lost responses. It is a deterministic component lifecycle test, not a browser layout test.
- Local audit tests cover old/new subjects, name search, detail redaction and unrelated event JSON that must not match a business subject.
- `npm run test:business-audit -w apps/api` runs an operator-only SQL fixture and rolls back its synthetic assignment event and workspace revision. Both reassignment subjects find the event; details remain redacted.
- Migration 068 was applied to `skill-management-dev`. A restricted-runtime read verified Anupriya's previously omitted responsibility event is now included (one stored event, one visible event).
- Scheduler migration 065 remains deferred. No people, responsibilities or historical grants were changed by this fix.
