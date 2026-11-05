# Recent commit audit and current FDD mapping

Reviewed `09d854d`, `cf840d6`, `c6a4b4e` and `7625c45`, the four implementation commits after `8123488`. Documentation commit `bc983c6` is the starting HEAD for these local corrections. Origin/main matched that HEAD when checked. Source: the complete body and tables of `C:/Users/utpatel/Downloads/SCMD FDD V0.1.docx`, re-extracted on 13 October. Its cover says version 1.0, Draft. User-approved increments take precedence over conflicting draft requirements.

## Confirmed issues corrected

| Issue | Consequence | Correction |
| --- | --- | --- |
| Review names derived from a global rank array | Historical/custom L2 records could be relabelled Autonomous, irrespective of their saved definition | Read the exact saved `levels` metadata returned by migration 077; missing metadata shows the rank without an invented name |
| Read-only history used immutable `needsReview` as current workflow status | Completed approved/rejected/change-requested items still looked undecided | Show recorded item status; decision controls and saves require a currently submitted, non-read-only group |
| Approval labelled verified | Suggested external issuer verification that a manager decision does not establish | Label the decision Manager reviewed |
| People page sorted client-side but labelled a scope-wide leaderboard | A holder on page two could outrank every displayed person without appearing | Label explicitly as a current-page comparison, including page size and total; global ranking remains unimplemented |
| Issuer record counts labelled certification headcount, category labelled Pillar, mixed activity labelled certification growth | Leadership could mistake different measures/dimensions for the FDD reports | Label the actual measures: credential records by issuer/category and submission/review activity, including all decision outcomes |
| Analytics level names Foundation/Working/Autonomous/Expert conflicted with the approved model | Wrong proficiency semantics, and historical rank equivalence was implied | Show ranks in aggregate filters/matrix with a saved-definition compatibility note; individual reviews retain actual definition names |
| YTD constructed a local January 1 then formatted it in UTC | Positive-offset time zones could start YTD on December 31 of the previous year | Use UTC year/day arithmetic matching reporting calendar boundaries |
| Minimum-only rank filters lacked an active chip; disjoint expiry windows lacked an option in the upper selector | Deep links/chart filters looked unapplied or could not be cleared consistently | Show/remove rank-range chips and preserve range and expiry-bucket selections in both controls |
| Empty workforce showed a 100% non-certified bar | Invented a percentage for a zero denominator | Both population segments remain zero for an empty workforce |
| Related-link/evidence/detail state persisted across changed targets | Previously loaded content or errors could remain while a different record loaded | Clear previous target state at read start; retain request cancellation and Blob cleanup |
| Analytics AI button appeared before/without analytics availability | Offered analytics tools to administration-only users | Gate discovery on canonical context `canView`; backend execution checks remain unchanged |

No SQL, account grants, review authority or production data changed in this audit. The corrections are local until separately released.

## Current FDD mapping

This table supersedes the corresponding statuses in the historical 12 October mapping; that earlier report remains pinned to its stated commit.

| FDD item | Current status | Remaining useful work |
| --- | --- | --- |
| Employee, current manager, scoped leads and admin | Implemented governed workspace foundation | Real SSO/directory and company-hosting acceptance remain deferred; titles never create access |
| Foundation, Autonomous, Experienced, Expert | Implemented versioned framework; 70 seeded definitions rolled out; older versions retained | Official organization rubric/master content can be maintained through catalogue governance |
| Oracle-only skill/provider content | Configuration, not a separate module | Import approved Oracle catalogue content through existing master management |
| Certificate supports many skills and skill supports many certificates | Implemented employee-record links, combined intake and atomic per-item review | Canonical credential-definition-to-skill master mappings remain missing; AI suggestions are not governed mappings |
| No duplicate certification per employee | Implemented normalized issuer/name and printed-ID identity with validated renewal ancestry | Explicit concurrent-writer acceptance and business decisions on renewal-superseded counting remain useful; no claim that a provider verifies ownership |
| Supporting attachment mandatory | Enforced before credential submission; incomplete drafts supported | User-approved certificate limit stays 5 MB; ordinary skill evidence is compressed images up to 10 MB. FDD's generic PDF/10 MB rule is a deliberate unresolved difference |
| Manager integrated workflow | Unified queue, analytics and recommendations implemented | Finish new production upload → multi-skill/multi-certificate review → outcome acceptance and two-session realtime checks |
| Lifetime certificates | Explicit no-expiry, stored null | Retain null rather than invent a 2050 expiry; external legacy export may adapt if mandated |
| Certification-wise headcount and global leaderboard | Partial data foundation, not completed by redesigned charts | Server-side canonical credential grouping, distinct current approved holders, global ranking before pagination, tie and renewal rules |
| Skill-wise headcount | Top-10 reviewed rank coverage implemented | Full governed catalogue report, zero-holder skills and framework/version-aware aggregation if required |
| Pillar/Practice/Community/Location/N+1 filters | Not established by generic category/scope controls | Agree canonical dimensions/source IDs before adding predicates or exports; account/client department and security tenant remain distinct |
| Monthly certification growth | Mixed submission/review activity only | Define achieved/new-current/net-growth semantics and implement the corresponding server measure |
| Certified versus non-certified population | Implemented current approved distinct-person split | Denominator is authorized active workforce; date controls affect activity, not historical population snapshots |
| Expiry notification milestones | Owner reminder foundation implemented | Organization-hosted durable scheduling, lead/monthly/threshold policies and delivery acceptance remain deferred; no new Vercel scheduler activation |
| Prior-company mapping exceptions | General requests/incidents exist | Dedicated exception workflow if business demand warrants it; no automatic issuer ownership inference |
| Corporate email eligibility | Provisioned tenant/object identity foundation | Authoritative organization eligibility/allowlist decision belongs with the real directory integration, not an email-only identity rule |
| Oracle CertView/My Learn | Future adapters | Do not claim current AI/learning features provide issuer/course synchronization |

## Recommended next priority

First add governed **credential definition → related skills** mappings to the existing catalogue/amendment workflow. It is the FDD's Phase 1 linkage foundation: one canonical credential can propose several skills consistently; AI factual extraction and additional suggestions remain reviewable; proficiency and experience remain employee-entered, and manager authority stays unchanged. Existing submitted snapshots must not be rewritten when mappings change.

Then implement the missing server-side certification headcount and global ranking using those canonical identities, with distinct-employee counts, approved/current validity, renewal treatment and pagination-independent exports. These are more valuable than adding more decorative charts. Complete production grouped-upload and realtime acceptance before declaring release readiness. Real SSO and scheduler activation stay aligned with the deferred organization deployment.

## Validation

187 frontend tests passed after the core fixes, including historical proficiency/status, UTC boundary, page comparison and the existing business filter lifecycle regression. Web typecheck and production build passed. Final validation after read-state cleanup is recorded in the task result. DOCX content was extracted without modifying the source; no visual document-layout review or full production acceptance is claimed. API/SQL policies were inspected but not changed or freshly runtime-tested in this audit.
