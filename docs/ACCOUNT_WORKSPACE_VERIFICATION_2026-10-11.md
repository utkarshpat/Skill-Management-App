# Account workspace verification — 11 October 2026

## Environment and release boundary

Verification used the local web/API against `skill-management-dev`, installed schema 064 and access revision 184. No employee records, responsibilities, project memberships or existing grants were changed. SQL mutation fixtures rolled back. Local code fixes have not been pushed or deployed; hosted Microsoft SSO acceptance remains pending.

## Actual development sessions

All 16 available non-Microsoft-linked active people signed in and out through the normal development-login browser controls. The same accounts were independently exercised through real HTTP development sessions, with 24 read endpoints per account (384 checks).

| Accounts                                                                                                                                              | Result                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Khushi Agarwal, Humayun Shahzad, Naveen Negi, Anjali Gupta, Mayank Dubey, Rohan Sharma, Shwetangi Tiwari, Samar Rathore, Kashika Khurana, Dhruv Kumar | Personal workspace APIs succeeded; review and Business Operations APIs correctly denied unassigned authority. Browser workspaces opened.                                       |
| Hemant Navlakha, Mukesh Rajput, Vivek Seth                                                                                                            | Personal workspace, assigned review queues, team analytics, recipient options and amendment reads succeeded. Organization analytics and access administration remained denied. |
| Vimmi Chachra, Anupriya Banerjee, QA Test Person                                                                                                      | Personal workspace succeeded. No manager or Business Operations authority was inferred from designation/template names.                                                        |

All 13 tested personal endpoints returned 200 for every demo account, including profile, effective access, notifications, dashboard/overview, own skills, certifications, learning, requests, catalogue and recommendations. No endpoint returned a server error. Protected Microsoft access administration rejected development sessions as designed.

Hemant's browser checks additionally covered certification review queue, analytics and recommendations and the live empty Amendments page. Mayank's personal certification page and empty portfolio rendered successfully. Browser observations and HTTP checks are different evidence: a loaded dashboard does not certify every dialog or mutation.

## Microsoft-linked System Admin

Utkarsh Patel is the remaining active account and is Microsoft-linked. Direct development login intentionally excludes it. No SSO credential/session was available in the connected browser; authentication was not bypassed.

The existing actor's canonical SQL access snapshot and runtime Business store were checked: all four dashboard datasets, organization totals, context, administration, masters, amendments and demands. Filtered zero-result queries and CSV/XLSX generation also passed. A read-only browser replay of these real authorized SQL responses verified Analytics, Demand & matching, Amendments, Projects & access, and the amendment dialog with empty provider/certification choices. This replay verifies rendering, not an actual Microsoft sign-in or hosted session.

Scoped Business Operations leads were tested in disposable SQL fixtures because no permanent lead assignment exists. Existing users were not promoted to obtain test coverage.

## Confirmed bug and fix

SQL JSON responses omit empty collections. Actual manager contexts lacked `scopes`; empty master lists lacked `providers` and `certifications`; amendment/demand lists lacked `rows`. Empty filtered dashboard charts and table lists were omitted too. Web components use array methods on these fields, so otherwise successful reads could trigger the whole-workspace recovery screen.

`SqlBusinessStore` now normalizes successful context, dashboard, administration and supported list reads to arrays before delivery to web/AI consumers. Existing collections and authorization/revision rechecks are preserved. Malformed non-array collections fail with 503 instead of being misrepresented as empty success. No installed SQL migration was edited for this fix.

Regression coverage checks empty/malformed collections and the SQL adapter delivery paths. Local empty-result dashboard and workflow pages now render their intended empty states without console errors.

## Validation

- Architecture, application/test TypeScript checks, build, generated-doc consistency and diff checks passed.
- Automated tests passed: architecture 6, API 278, web 167 (451 total). The full suite ran before the final adapter regression; API tests were rerun afterward and passed.
- All 17 opt-in Business Operations SQL scenarios passed, including foreign/inactive account boundaries, scoped DENY, multi-project deduplication, workflow/matching, renewal conflicts, stale previews, inactive people, historical grants and administration lockout. Fixture cleanup passed.

Remaining acceptance: actual hosted Microsoft SSO sign-in, hosted deployment of the local fixes, and end-to-end external provider/Blob/AI actions. Read verification and rollback fixtures do not establish that every external integration has been exercised live.
