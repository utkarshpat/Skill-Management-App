# Demo skills and certification acceptance — 14 October 2026

The user authorized adding varied skills and supporting certifications to the existing dummy accounts, leaving two empty. Data was created through ordinary authenticated APIs on the hosted application, using existing published catalogue definitions and current assigned manager reviews. No permissions, reporting relationships, real SSO accounts or catalogue entries were changed.

All generated files, credential IDs, notes and experience descriptions identify the records as synthetic demo data. They are not actual qualifications or issuer verification. The shared demo database makes this data visible in both hosted and local environments.

## Populated portfolios

| Demo person       | Skills | Certificates including renewal history | Scenario                                                            |
| ----------------- | -----: | -------------------------------------: | ------------------------------------------------------------------- |
| Khushi Agarwal    |      4 |                                      4 | Approved, expired retained, no expiry, approved renewal             |
| Humayun Shahzad   |      2 |                                      1 | Mixed item decisions: approved skill/certificate and returned skill |
| Naveen Negi       |      3 |                                      1 | Pending assigned manager review                                     |
| Anjali Gupta      |      3 |                                      3 | Approved, expiring, returned renewal keeps original current         |
| Mayank Dubey      |      3 |                                      1 | Changes requested, corrected, resubmitted and approved              |
| Rohan Sharma      |      3 |                                      1 | Changes requested                                                   |
| Shwetangi Tiwari  |      3 |                                      1 | Not approved                                                        |
| Samar Rathore     |      2 |                                      1 | Incomplete draft, blank experience, missing mandatory file          |
| Kashika Khurana   |      0 |                                      0 | Empty portfolio                                                     |
| Dhruv Kumar       |      3 |                                      1 | Approved certificate expires on server UTC date                     |
| Hemant Navlakha   |      2 |                                      1 | Approved by his manager; 14-day expiry window                       |
| Mukesh Rajput     |      3 |                                      1 | Approved by his manager; later expiry                               |
| Vivek Seth        |      2 |                                      1 | Draft; submission blocked without assigned manager                  |
| Vimmi Chachra     |      3 |                                      1 | Draft; submission blocked without assigned manager                  |
| Anupriya Banerjee |      2 |                                      1 | Approved, 3-day expiry window                                       |
| QA Test Person    |      0 |                                      0 | Empty portfolio                                                     |

Totals: 38 distinct skill claims, 19 physical certificate records including two new renewal records, and 17 combined submission/history bundles. Skill outcomes: 21 approved, 3 submitted, 4 changes requested, 3 rejected, 7 drafts. Certificate outcomes including history: 12 approved, 1 submitted, 2 changes requested, 1 rejected, 3 drafts. One approved source certificate is superseded in the current portfolio but retained as history.

The scenarios include all four proficiency levels, zero and longer experience, uncertified skills, multiple skills supported by a certificate, multiple certificates supporting a skill, PDF and compressed image attachments, no expiry, expired, expiry today, and 3/5/7/10/14-day renewal windows.

## Verified behavior

- Employee save/upload/submit and exact current assigned manager review succeeded.
- Mixed item decisions did not approve every skill automatically.
- Corrected resubmission retained original review history without creating duplicate claims.
- Approved renewal replaced the visible current version, retained old files/history and preserved skill links. Returned renewal did not supersede its source.
- Concurrent duplicate review returned one success and one conflict. Stale submit and review also returned conflict.
- Self review, unrelated employee reads and a different manager's approval attempt were denied.
- Missing manager and missing mandatory certificate file blocked submission.
- Files over 5 MB and invalid calendar dates were rejected; the rejected date save did not change the draft revision.
- Assigned manager could read file metadata and bytes. Scoped Analytics could read an approved expired credential, but could not read private draft or returned credential files. Metadata did not expose private storage keys.
- Ordinary employee Analytics access was denied. Scoped CSV export succeeded and excluded private drafts.
- Manager submission notification was present. Hosted Analytics was visibly populated.

## Analytics reconciliation

Anupriya's authorized UK scope showed 14 employees, 8 currently certified employees, 8 reviewed skill holders, 6 pending individual records, 1 expired certificate, and 10 certificates in the next 30-day window. Counts reconciled with scoped people, skill and certificate tables. Seeded owners' reviewed skills/current certificates also reconciled independently with their personal portfolios. Drafts and the superseded renewal source were excluded from Analytics records.

This scope also contains pre-existing Utkarsh records: those were preserved and explain why pending Analytics records exceed the seeded Naveen request's four items. The scope excludes unassigned root accounts; it is not a count of all demo users.

## Evidence and limits

Ignored local journals contain stable record IDs and API results: `.local/demo-capability-seed-2026-10-14.json` and `.local/demo-seed-verification.json`. Screenshot: `.local/demo-seeded-analytics.png`. They contain no login cookies or access code. Base seeding and renewal/resubmission follow-ups all completed; completed journal entries are skipped on rerun.

These checks cover the listed scenarios, not every possible edge case. Scheduler delivery, real SSO, every AI feature, demand matching and a complete browser interaction for each account were not retested in this data-population task. Expiry boundaries use the server UTC date. The separate Analytics redesign remains local and was not deployed by this task.
