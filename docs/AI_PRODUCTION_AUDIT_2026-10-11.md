# Production AI audit — 11 October 2026

## Outcome and scope

Tested the AI features on https://skill-management-app.vercel.app using normal, authorized demo sign-ins. Employee and current-manager answers were compared with authenticated API records and effective-access projections. Native browser checks covered the assistant, learning planner and recommendations. Confirmed defects were fixed, pushed to `main` and deployed; the final code release is `56dbef4` (Vercel deployment completed successfully).

These are verified scenarios, not a guarantee that every possible model response is correct. Real Microsoft SSO and positive Business Operations/System Admin acceptance remain deferred at the user's request. No role, permission or scope was granted for this audit. The approved contract remains [ACCESS_MODEL_REDESIGN.md](ACCESS_MODEL_REDESIGN.md); conceptual scope support is not proof of execution-time authorization.

## Confirmed defects and fixes

| Defect reproduced | Result after the fix |
| --- | --- |
| Ordinary personal writes advanced a global revision and caused “Business scope changed during this reply” or hid personal chat history. | Personal context no longer depends on unrelated global revisions. Real business access changes still invalidate context; managers and business/admin readers retain conservative cross-person revision checks. A synthetic request creation preserved two existing chat messages with `contextReset: false`. |
| Assistant said certifications were unavailable despite saved credentials. | Actor-bound `my_certifications` and exact assigned-manager certification queue tools now read the existing stores with permission, relationship and membership rechecks. No new grants or writes. |
| Own-profile answers lacked organizational facts. | Own-profile context uses the existing actor-bound organization adapter for DU, department, team and manager; missing facts remain missing. |
| Review assistance described 2 October 2026 as a future date on 11 October. | Server UTC date and explicit last-used timing ground the response. Live review assistance correctly described it as on or before today. |
| Requested Hindi/Roman Hindi quiz counts were not consistently recognized. | Count parsing supports Roman Hindi, Hindi question words and Devanagari digits. Exact output-count enforcement remains mandatory. Live three-question networking quiz returned exactly three questions. |
| Workflow AI accepted raw source JSON as a user-facing action note. | Prompts require natural-language notes; raw/fenced JSON notes fail validation with a manual fallback. COMMENT, START, RESOLVE and REASSIGN live drafts returned readable notes. |
| Recommendations interpreted omitted private evidence text as absent evidence, and missing/unreviewed claims as measured low ability. | Tools expose only saved project/reference presence flags and actual claimed rank. Recommendations distinguish saved presence, unverified claims and possible development opportunities. Private narrative/reference contents stay excluded. |
| AI responses exposed internal evidence flag names in prose. | Context now explicitly requires plain-language explanations. Final Hindi Java response correctly said projects/references were present and draft status did not establish low ability. |
| Knowledge Transfer access answers focused on table inserts rather than approved policy. | Access questions prioritize the approved baseline and locked invariants; instructions distinguish policy from installed behavior and avoid recommending direct grant-table writes. |
| Generic workflow explanations could describe OWN as creator-only or imply creator authority to resolve. | Always-on personal workflow context explains both submitted and assigned records. Final Hindi check said both are included, and only current recipient Hemant could resolve an in-progress request with the required permission. |
| Planner refinement displayed “Adding to calendar…” before confirmation. | Refinement displays “Refining roadmap…”; calendar wording applies only to actual confirmation. |

Code releases: `9c34228`, `8b54be4`, `53a5ffd`, `b0968b9`, `77df018`, `56dbef4`.

## Production feature verification

| Feature / scenario | Verified behavior |
| --- | --- |
| Natural-language profile questions, including Hindi | Matched current employee code, DU, department and manager; missing job title/grade/team were not invented. |
| Personal permissions and navigation | Used effective access and available pages rather than role labels; no employee review, business analytics or admin authority invented. |
| Certification portfolio and validity | Returned five credentials, including one manager-reviewed but expired credential. Review status remained separate from calendar validity and issuer verification. |
| Certificate upload/view/renewal guidance | Explained implemented UI actions and reminders without claiming background email delivery. |
| Manager team / queue questions | Matched 11 active direct reports, two assigned pending skill reviews and zero assigned pending certification reviews. Assigned queue was not described as the entire team credential portfolio. |
| Private-person requests and role spoofing | Refused another employee's private drafts/credentials and requests to ignore policy or assume System Admin authority. |
| AI learning planner | Generated and refined an editable two-day, 20-minute-per-day roadmap in the production UI. No plan was saved without explicit calendar confirmation. |
| Learning recommendations | Used saved claims and evidence-presence facts; did not treat synthetic QA records as real professional accomplishments or unreviewed status as measured inability. |
| Skill-claim draft, incident/request draft and task roadmap | Returned editable assistance; no automatic submit, approval or record mutation. |
| Saved-task help and practice quiz | Used the selected task. Two-question practice attempt saved a 2/2 score with correct explanations; practice did not verify skill proficiency or alter task completion. |
| General English and Roman Hindi quizzes | Requested counts and networking facts checked, including OSI seven layers, network layer and DNS. |
| Manager review summary and feedback drafts | Authorized manager received grounded drafts; employee review assistance returned 403. Reviewed claim revision/state remained unchanged. |
| Workflow COMMENT / START / RESOLVE / REASSIGN drafting | Natural-language notes returned; AI drafting did not advance record revision. Terminal-record drafting correctly returned 403. |
| Workflow recovery advice | Returned guidance without applying recovery or bypassing state checks. |
| Knowledge Transfer / access policy | Returned approved invariants, DENY precedence, relationship checks and Preview → Recheck → Transaction → Audit. Access for this feature is legitimately available through `profile.view`; an employee 200 is not itself an authorization defect. |
| Personal history after a workflow write | Existing messages remained accessible without a false context reset. |

## Fact checks against current production records

The demo account is Khushi Agarwal, employee code `DEMO-NHS-002`, DU `UK`, department `NHS SBS`, current manager Hemant Navlakha. Team, job title, grade and primary capability were absent and were not inferred.

Four saved skill claims were distinguished by status: React approved Beginner L2; QA Skill Review Workflow approved Practitioner L2; API Design submitted Awareness L1; Java draft Intermediate L3. Java had saved projects and evidence references. Their contents were not exposed through the assistant's compact skills tool. QA/E2E records are synthetic test fixtures, not verified professional evidence.

Five credentials were present: four manager-reviewed and one changes-requested. `microsoft fundamentals AZ900` remained manager-reviewed but had expired on 8 October 2026. The synthetic File and expiry acceptance credential expired on 25 October and was in the implemented 90-day “Expires soon” window. Three others were current. Counts and dates were checked against the authenticated portfolio, with UTC 11 October as the reference day.

Hemant had 11 active direct reports and two assigned pending API Design skill claims, from Khushi and Naveen. His assigned pending certification queue was empty. Current-manager amendment eligibility did not grant Business Operations analytics, demand or administration rights.

The final Hindi workflow answer explicitly confirmed that Personal/OWN workflow access covers both “My requests” and “Assigned to me”. Request creation alone did not grant Resolve: current recipient, in-progress state and Resolve permission were still required.

## Mutation safety and evidence

AI-generated review feedback, plans and workflow notes remained drafts. Read-only assistance did not approve claims, create learning plans, grant access or change existing review revisions. Synthetic workflow setup records `REQ104` and `REQ105` were cancelled after testing. Explicit setup/start/cancel actions were confined to those synthetic records. The practice quiz attempt was an intentional saved test result.

Local production evidence is stored under ignored `.local/`: `ai-production-audit.json`, `ai-flow-audit.json`, `ai-fixed-verification.json`, `ai-workflow-live.json`, `ai-final-answers.json` and `ai-scope-final.json`. Browser proof: `ai-production-fact-check.png` and `ai-planner-production.png`. Authentication credentials/cookies are not included in this report.

## Automated verification

- Broad checks passed: 6 architecture + 283 API + 169 web = **458 tests** across the audit.
- A focused AI, learning, workflow, Knowledge Transfer and business suite passed **93 tests**; these overlap the broad total and are not an additional 93 unique tests.
- Subsequent small context changes passed targeted suites (17 context/navigation/workflow tests and 5 typed-tool/workflow tests).
- Typechecks, builds, documentation generation checks and `git diff --check` passed during the release work. Final API context changes also passed API typecheck/build.
- One unrestricted-parallel API run encountered the existing PDF validator cold-start timeout on a valid fixture. The complete 283-test API suite passed with concurrency limited to two. PDF behavior was not changed in this audit; build/test operations were kept sequential because the build-cache test removes generated `dist` output.

## Remaining acceptance boundaries

1. Live Microsoft SSO and actual organization API identity mapping remain untested in this demo audit.
2. Positive Business Operations/System Admin scoped analytics scenarios need appropriately authorized identities; no temporary grants were created. Local policy tests cover relevant denial/revocation contracts, but do not replace hosted positive acceptance.
3. Credential reminder milestones are computed on notification reads at 14/10/7/5/3/0 days. Scheduled background/email delivery is not implemented and must not be advertised as available.
4. AI replies may take several seconds for server reads and provider tool rounds. These checks establish correctness for tested cases, not a latency guarantee.
5. Context/tool contract updates can legitimately reset older chat context once on deployment. Ordinary subsequent personal writes were tested to preserve history. Conservative cross-person policy revision invalidation remains in place.

