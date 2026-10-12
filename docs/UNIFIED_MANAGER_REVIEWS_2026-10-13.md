# Unified manager reviews — local verification

The user reported that production still displayed separate Skills and Certifications tabs after the personal skill/certificate flow had been unified. Local implementation and verification were completed under the earlier instruction not to push. The user subsequently authorized pushing these reviewed fixes to main on 13 October 2026; hosted deployment verification remains a separate release step.

The manager workspace now has one navigation: Review queue, Team analytics and Recommendations. Linked submissions are shown as review requests. Earlier individual credential reviews remain visible when pending, and earlier individual skill reviews/recorded decisions are available in a disclosure that opens when records match. They are not deleted or silently treated as linked requests.

The analytics view retains existing direct-report skill analytics and assigned pending credential analytics on the same page. Credential analytics still summarize currently assigned pending submissions, not all approved team credentials. The recommendations view includes both existing governed skill and credential recommendation workflows. Canonical server availability and execution checks are unchanged; no new authority or scope is introduced.

Legacy type=skills, type=certifications and type=all URLs resolve to the unified queue. Analytics/recommendation tab links remain supported, and manual navigation updates the URL without leaving obsolete record targets behind. Typed recommendation notification links focus only the matching recommendation feed. A linked claim detail routes to its combined submission instead of exposing an individual decision path. The combined GET and decision APIs continue to enforce current assigned manager, active people, revision, reviewable state and no self-review.

Queue/recommendation/analytics panels fetch their relevant data without fetching the independent credential queue while displaying analytics or recommendations. The linked list now shows loading state before announcing an empty queue.

Validation: 183 frontend tests passed, including legacy navigation links and the absence of separate review-type tabs. Typecheck and web build passed. Local browser verification used the existing Hemant demo manager, opened all three views, verified recommendation feeds load and confirmed selected tab URLs. No recommendation or review decision was sent through the browser and no test records were saved. The earlier linked-flow SQL evidence is recorded in LINKED_FLOW_AUDIT_2026-10-13.md; actual hosted two-browser realtime and Blob upload/download remain separate acceptance steps.

No deployment or permanent migration installation was performed during local verification. Migration 077 remains pending coordinated installation after the matching web/API deployment is available.
