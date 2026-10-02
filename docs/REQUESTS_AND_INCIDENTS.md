# Requests and incidents: preserved workflow requirements

Status: planned, not implemented. Permission codes and editable permission sets already exist; there are no request/incident records, routes, approval executors or AI write tools yet. My Skills does not implicitly create these records.

## Separate responsibilities

Requests represent a routed business action needing a recipient or approval: for example an access grant/revoke or another configured workflow request. Incidents represent an IT/service issue needing triage, assignment and resolution. Each needs its own state transitions, ownership, comments and timeline; a skill self-assessment is not an incident.

Routing must use configured people/groups and current reporting relationships. A direct manager and that manager's manager are derived by following the reporting tree; they are not role names or fixed levels assigned to everyone. Broken or circular reporting lines block routing with an actionable administrator message. Administrator-defined role labels do not confer approval authority.

## Implementation requirements

Use the existing `request.create/view/assign/approve/resolve` and `incident.create/view/assign/resolve` codes with trusted resource scopes. OWN permits a person to view their own records; assignment and approval must resolve the actual recipient and current authority. Department/team/resource scope bindings are still pending and must be implemented before using those scopes for routing. Never substitute an ORGANIZATION grant for an unsupported narrow scope.

Store the requester, recipient/assignee, type, record revision and transition history in account-scoped SQL. Enforce transitions and audit in the same transaction. Comments and attachments inherit the record's current access rules. Notification delivery must use real committed workflow events, with an outbox or equivalent retry-safe process; the current notification bell is an empty UI shell.

An approved access request does not itself authorize an arbitrary role or permission change. Execution must recheck the actual grant authority, permitted scopes, target membership and the exact approved payload. Block self-approval and stale approval execution; use idempotency to prevent duplicate grants. Sensitive approval outcomes remain human decisions.

## AI integration boundary

Future tools may read a person's permitted requests/incidents, draft a request/report, or propose an exact action. Add each to the typed registry with explicit permissions and resource resolution. AI cannot invent recipients, expand scope, silently change access, resolve an incident or approve a request. Writes require an expiring, version-bound proposal displayed for human approval, followed by a fresh policy check and transactional execution/audit.

Build after the claim/evidence/review slice, or reprioritize explicitly. Keep notifications, assignment and request approval separate from the existing read-only chat. Provider selection, data retention and live model configuration remain pending.
