# Personal notifications

Implemented 3 October 2026. GET /api/notifications derives the actor from verified Microsoft mapping or the existing opaque loopback development session. It requires an active person and current own-profile access. Actor/person query strings do not select another recipient. Responses use no-store.

The initial feed projects actual person.updated audit events addressed to the signed-in person and performed by another actor. It returns at most 30 newest events from the available audit snapshot, with generic title/body, event ID, time and trusted /profile link. No administrator identity, before/after permission payload, other people or workspace audit records are exposed. No fake reminders, review notices, AI chat messages or learning deadlines are synthesized. Event history is bounded by the existing audit snapshot; this is not a complete historical inbox.

The navbar bell shows the unread count, empty/loading/error states, Refresh, Retry, Mark all as read and clickable entries. Clicking marks that entry read and navigates without document reload. Only read event IDs are stored locally under the recipient's ID (bounded to 100); reading is device-specific, not persisted to SQL. Browser storage failures retain session behavior. Polling happens every 60 seconds while visible, plus when returning to the tab; it is not WebSocket/push delivery. Failed or revoked requests clear displayed feed data.

Future learning/review/incident modules must emit recipient-scoped events through a dedicated durable notification/outbox service, with SQL read receipts, retention and delivery retries. That service and cross-device read synchronization are not implemented by this increment.

Tests cover actor forgery, anonymous access, live DENY, recipient isolation, omission of audit payloads and bounded ordering. Browser checks use an in-memory fixture for unread badge, reading and refresh persistence; they do not change Azure records.
