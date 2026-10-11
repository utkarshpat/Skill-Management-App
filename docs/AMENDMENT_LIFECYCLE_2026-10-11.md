# Catalogue request lifecycle verification

The composer uses Choose change → Request details → Preview & submit. Requesters can open a request from its list or notification, see its status, submitted definition, dates and administrator feedback. Successful submission opens the saved request, rather than leaving an ambiguous empty form.

Administrators compare the current catalogue definition with the requested definition before writing feedback and previewing a decision. A stale target blocks approval; rejection remains available to explain why a fresh proposal is needed. Current target details are a live comparison, not a historical before snapshot.

Migration 066 retains the existing actor, account, scoped deny, revision, preview and audited SQL transaction checks. It serializes duplicate checks through the existing workspace update lock. Different IDs cannot create pending updates for the same target, or pending additions of the same normalized name/type (and provider for certifications). Existing historical duplicates are not silently removed. Exact ID/payload replay still recovers the original mutation. Rejection does not create or change a catalogue entry.

The actor-addressed notification projection supplies pending requests to currently authorized catalogue decision makers and decisions/feedback to their authorized proposer. Links open `/skills?tab=amendments&request=...`; unrelated employees receive no request payload. Delivery follows the existing activity refresh/notification polling contract, not push or email. Saves trigger notification refresh and other open request views refresh on notification changes or focus.

Verification: typecheck, production build, 172 web tests and business API contracts; development SQL rollback scenarios verify provider/certification/skill approval, exact replay, rejected provider absent from catalogue, feedback and notification recipients, duplicate proposal rejection, and stale target comparison/approval rejection. Migration 066 is installed on `skill-management-dev`. Migration 065 remains reserved for the separate deferred scheduler branch and is not activated here.

SQL tests use synthetic identities and roll back. They do not establish a production Microsoft SSO administrator login or approval acceptance; that remains a separate authenticated check. No access assignment was added for testing.
