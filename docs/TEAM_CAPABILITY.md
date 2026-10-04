# Team capability — first increment

Skill reviews now has a Team capability tab when both review and non-own skill-view permission exist and the SQL store implements it. This increment covers current active direct reports only. It does not expose every employee for an organization grant, recurse into indirect reports, or infer access from a role name.

`GET /api/skill-reviews/team` accepts bounded `search`, `page` and an optional UUID `person`. The server derives the actor from verified identity; forged scope/actor selectors and repeated values are rejected. Migration 027 resolves allowed IDs inside the current account through reporting assignments, excludes self and inactive people, and checks own profile, review and skill-view access. Foreign/self person selectors return unavailable. The route repeats authority checks after retrieval and discards a changed workspace revision.

The roster contains names/codes and full counts of APPROVED skills and SUBMITTED claims assigned to the current actor. Details load only for the selected accessible employee and contain skill/category/level/status. Employee drafts, changes-requested/rejected records, private descriptions, project/evidence text and claims assigned to other reviewers are excluded. A new manager may see currently reviewed capability but cannot review pending claims addressed to the former manager; existing submission/review routing remains authoritative.

The UI provides server-side name/code search, paginated person cards, employee skill details, explicit empty/error/loading states, refresh, back and an Open review queue action when there are pending assigned claims. It creates no domain records and does not imply learning completion verifies capability.

SQL rollback checks cover exact direct report scope, foreign/self selectors, manager reassignment, inactive employees, permission revocation, minimal detail and counts. HTTP tests cover independent permissions, identity binding, query rejection and mid-request revocation. Existing review tests cover decision feedback, stale versions, self/unassigned reviews, changes/resubmission, notifications and audit.

Next increments: improve the review queue with server-side search/status/person filters and review history, then add permission-bound AI evidence summaries/feedback drafts. The supplied dashboard reference guides a later layout refinement; assessment, demand, announcements and recommendations require working data sources before becoming cards.

Production verification on 2026-10-04: deployment `26xB4CuMWMtvytFWWYmRwFDJdEA5` reached Ready without a Git push. Migration 027 applied successfully. The owner's Chrome showed Hemant's 11 current direct reports, name search returned Khushi only, and her detail showed one reviewed claim while excluding her private draft. At 390px viewport, document width remained 375px with the table contained in its own wrapper. Anonymous team API returned 401; health and review page returned 200. All 137 automated tests, strict types, builds and architecture boundaries passed, plus the separate SQL rollback checks. No domain records or permission changes were retained from testing.

