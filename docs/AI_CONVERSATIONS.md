# Durable AI conversations

Delivered 3 October 2026. Migration 009 is applied to the personal development Azure SQL database.

## User experience

- Open the assistant and use the history icon for recent chat titles and dates.
- Resume a chat with its formatted answers, draft/practice cards and sources.
- New chat does not save an empty conversation. Only a successful reply creates it.
- Keep two most recently updated chats per person. Saving a third removes the oldest in the same SQL transaction.
- Delete removes the selected chat permanently. Historical transcripts are personal records, not current permission or verified-skill evidence.
- Each chat retains at most 20 recent exchanges and may retain fewer for large answers/cards. Older user-request excerpts continue as bounded, untrusted model context.
- Refresh, idle time and API restart preserve saved history. Development login itself still expires/restarts independently; reselect the same person to resume their chats.

## Storage and authorization

`dbo.AiConversation` has a compound account/person/conversation key, revision, title, update time and bounded JSON payload. `dbo.OwnAiConversations` handles authenticated list/read/save/delete. The runtime principal has procedure EXECUTE only; direct table reads fail. Procedures check runtime account binding, active account and current own-profile access under a workspace transaction lock. No client actor or account selectors are accepted.

Persist the display transcript separately from compact model context. The browser receives the transcript, never internal policy fingerprints. User/assistant excerpts are untrusted and never grants. Current capabilities and tool checks stay authoritative. A changed effective capability fingerprint resets the model context on resume; it does not rewrite historical transcripts.

Model input uses the existing two recent complete turns, assistant excerpts capped at 1,800 characters, and up to four earlier user-request excerpts of 180 characters. It does not resend the full stored transcript. The 18,000-byte history and 32,000-byte per-round model transport bounds remain. Display messages are bounded to 40 and 200,000 serialized characters, dropping whole older exchanges. Each SQL JSON payload has a 512 KiB limit. No new cache/model service is introduced.

Successful saves check the expected revision and atomically trim to two conversations. Deleted/changed references cannot be silently recreated by stale requests. Failed SQL persistence returns a retryable error without falling back to process memory or evicting existing chats. Per-person generation locks and request budgets remain process-local; distributed quotas and new-request idempotency are future deployment work. An interrupted response can already be saved: use history to recover it before resending.

## Verification

- `npm test`: 76 passing checks across architecture, API and web.
- `npm run typecheck` and `npm run build`: pass. The existing large frontend chunk warning remains.
- `npm run test:conversations -w apps/api`: runtime SQL isolation, two-chat retention, revision conflicts, deletion and denied direct table reads. Fixtures roll back; employee/permission records remain unchanged.
- Automated service checks: resume across new service instances, actor isolation, storage failures, bounded display history, policy changes, deactivation and HTTP error handling.
- UI checks: recent chats, third-chat replacement and refresh/resume with Markdown in an isolated fixture; live Microsoft workspace checked in the user's Chrome with local greeting responses, creating only personal chat history. Phone controls fit a 390px viewport without document overflow.

Approved skill-write proposals, evidence uploads and persisted learning attempts remain separate next increments. Stored practice cards do not record test attempts or verified skills.
