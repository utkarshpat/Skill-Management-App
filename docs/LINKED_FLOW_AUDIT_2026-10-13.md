# Linked skill and certificate flow audit — 13 October 2026

Scope: user-authorized local testing and fixes, followed by explicit push authorization on 13 October 2026. The development database also backs the hosted demo; SQL fixtures roll back their records, grants and DDL. Permanent migration installation and hosted acceptance remain separate coordinated release steps.

## Confirmed defects fixed locally

1. Reopening a materialized draft fabricated five generic proficiency choices. Migration 077 returns the criteria and names belonging to the exact saved definition version, including historical versions. The composer restores those choices instead of inventing levels; save validation requires the selected rank to belong to those choices.
2. Renewal ancestry was omitted from materialized draft GET and credential OPTIONS, and the composer did not restore it. Migration 077 includes the immutable source reference; the composer retains it when continuing a group, selecting an existing credential, or opening an initial credential. SQL tests reopen and resave a grouped renewal without losing its source.
3. New and newly selected existing certificates were implicitly linked to every selected skill. These start with no assumed support links. User checkbox selection or explicit selection of a matching AI suggestion establishes links. Existing initial-credential links remain preserved.
4. Autofilling a second certificate replaced the first certificate's skill suggestions. Suggestions now retain their certificate source independently; refreshing one certificate replaces only that source's suggestions. The recommendation strip deduplicates canonical skill IDs, hides selected skills, and only uses still-present certificate sources. Selecting a suggestion links the applicable source certificates, without inferring proficiency.

The earlier unpushed redundancy cleanup remains included: selected chips open skill details, the duplicate details list is removed, and supporting certificate checkboxes live in each skill dialog.

## Verified checks

- 182 frontend tests and 296 API tests passed; workspace typechecks, builds, architecture checks and generated documentation checks passed.
- 17 linked SQL scenarios passed: draft discard/restore, foreign/stale draft actions, save/submit/review, many-to-many analytics, foreign access, stale revisions, missing attachments, unlinked certification, manager change, staged intake transfer, incomplete decisions, immutable snapshots, linking reviewed records, standalone-submit rejection, explicit reroute and returned-credential compatibility.
- A returned certificate was corrected and resubmitted with previously approved skills reused; only the certificate required a new decision, and the previous review remained unchanged.
- Two skills and two certificates produce four links, but authorized analytics still report two certificate rows, one certified employee and one skilled employee. Issuer totals count two credentials, not four links. One grouped request creates one manager notification. Submitted-file metadata is accessible through the authorized business-file path.
- Six credential identity/renewal SQL scenarios passed, including normalized names, printed identifiers, missing identifiers, renewal chains, forged foreign source rejection and grouped renewal recovery. GET and OPTIONS preserve the renewal source, and a recovered group can be saved again.
- Five business-file SQL scenarios passed: allowed scoped read, private draft rejection, foreign-scope rejection, explicit DENY and revoked responsibility. Synthetic historical credential fixtures explicitly represent pre-linking records; submitted-file checks use an actual combined submission rather than a prohibited standalone transition.
- Skill evidence submission/resubmission snapshots, equal timestamps, historical provenance, current reviewer checks and stale/locked uploads passed their SQL fixture. No Blob objects were written.
- Synthetic AI extraction can return up to six published canonical skills, rejects invented candidate IDs and does not assign proficiency. Frontend regression verifies multiple certificate sources are retained independently.

## Release and remaining acceptance

Release `8123488` was pushed to main with the user's authorization. After the matching hosted composer and unified manager bundles were verified, migration 077 was permanently installed on `skill-management-dev`, which also backs the production demo, on 13 October 2026. No access grant, review policy or scope support changed. The post-installation rollback scenarios `happy`, `snapshot`, `analytics-many-to-many` and `intake-file` passed against the installed database.

Production browser inspection as the authorized Hemant demo manager confirmed one combined pending request containing a skill and a credential. Its existing PDF loaded through the authenticated attachment path, displayed its first-page preview, and exposed View evidence and Download controls backed by the loaded Blob. No review decision was submitted. This verifies retrieval and preview of an existing production attachment; a new upload followed by submission and review, an actual download click, and two simultaneous browser sessions receiving realtime updates remain separate acceptance checks. AI extraction used synthetic providers here; live provider quality and issuer validity are not established by these tests. No explicit simultaneous duplicate-write race fixture is claimed. Subsequent UI commits are outside the code-review evidence for release `8123488`.
