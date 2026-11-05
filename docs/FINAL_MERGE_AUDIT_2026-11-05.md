# Final integration audit — 5 November 2026

The user authorized the audited logical changes to be integrated into main and requested final deployment source and migration packages. The 90% coverage target is explicitly deferred until after this integration; the threshold remains implemented and CI reports it without blocking this release. This is not a claim of 90% coverage or hosted acceptance.

## Included

- `f76b4df` and its audited hierarchy prerequisites: workflow-only assistant guards, recovery/practice response validation, Portfolio Business Analytics scopes and hierarchy filters, realistic regression coverage and current-source coverage provenance.
- `43be521`: archived historical audit/demo reports and repaired links. Reports remain retained, not deleted.
- `8524419`: additive, preview-first, receipt-bound catalogue operation template and collation safeguards. The proposed catalogue is optional operator-reviewed data, not an automatically applied migration or independently certified current issuer catalogue.
- Stable 37-file snapshot of the UI audit worktree at `8524419`: person-first People & Access, selected-person organization handoff, shared initial review loading, request topic discovery and relationship-based recipient defaults. Duplicate authentication tests were already identical; the older coverage runner/report was retained only in the private snapshot, preserving the complete-inventory runner on main.

## Corrections during integration

- Workflow migration `089` collided with Portfolio scopes. It is now **090**, registered after 088/089, with tests and rollout references updated.
- The person overview required a client ID even for valid Project-only placement. It now accepts either canonical client-only or Project-only placement and rejects conflicting simultaneous bindings; the complete active ancestry still must validate.
- Recipient defaults joined nullable client IDs directly, missing valid Project-only peers. The SQL now resolves each assignment through its active organizational Project/client path, keeping Business project membership independent.
- Legacy review history remains initially open and stable while filtering. New queue loading coordination does not restore the older collapsing behavior.
- Existing adapter, UI and browser fixtures now reflect the required server topic inventory and new navigation labels while retaining preview, revision, audit and denial assertions.

## Excluded

| Branch/change                                  | Reason                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `code-first-implementation`                    | Explicit user instruction: keep separate. SQL migrations remain the current schema delivery mechanism.             |
| `codex/session-extension` (`26d77dd`)          | Extends obsolete hosted-demo sessions; company operation uses verified Entra SSO with demo login disabled.         |
| `codex/certification-reminders` (`ef805be`)    | Previously deferred scheduler, schema 065 and hosting prerequisites; activating these is outside this integration. |
| Older duplicate partial-coverage runner/report | Would replace complete-inventory measurement and current-source validation with an older workflow.                 |

Other local branches examined were already ancestors of the integration. The source audit worktree was snapshotted without modifying or committing its files.

## SQL and release boundaries

Actual SQL Express execution used only the previously created isolated `SkillMgmt_PortfolioAudit_*` database and fictional Aditi Menon, Rohan Mehta, Neha Rao, Arjun Sethi and Zoya Shah. Workflow acceptance verified same-Project defaults, reporting-manager inclusion, sibling/outside exclusion, explicit name search, Platform administrator suggestions, topic gates, canonical create, idempotent retry and audit. Fixtures rolled back. Portfolio acceptance is recorded separately in [the scope record](PORTFOLIO_SCOPES_2026-11-05.md). No company SQL data/schema or live deployment was changed by this work.

For the company database last reported at 087: stop traffic, apply 088, review/apply the explicit Portfolio mapping, then apply 089 and 090 before releasing the matching app. No organization-specific Portfolio mappings or reporting relationships are invented. The final migration package includes ledger-aware transactional SSMS wrappers and the preview-first mapping template. The catalogue data template is optional and must not be treated as a required schema step.

The final unit/browser/build results are recorded in the release package manifest and ignored `artifacts/release-*` logs. SQL Express acceptance does not establish Azure managed-identity grants, real Entra consent/MFA, hosted performance or all 39 SQL-backed application integration suites. Earlier coverage percentages remain dated diagnostics; current coverage will be measured again in the subsequent coverage task.

## Final local verification

| Check                                             | Result                                                                                                                                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API tests                                         | 452 passed; zero failed/skipped/cancelled                                                                                                                                                     |
| Web tests                                         | 424 passed; zero failed/skipped/cancelled                                                                                                                                                     |
| Tooling/architecture/package tests                | 8 passed                                                                                                                                                                                      |
| Browser scenarios                                 | 64 verified across desktop/mobile: 60 passed in the full run; four request-composer scenarios expected obsolete empty-state wording and passed complete reruns after the assertion correction |
| Typechecks, production build, generated documents | Passed                                                                                                                                                                                        |
| Changed-document file links                       | Zero broken references found                                                                                                                                                                  |
| Migration wrappers                                | 089/090 installed with ledger entries on the local isolated DB; 088/089/090 repeat calls returned ALREADY_INSTALLED                                                                           |

The corrected browser rerun matched exactly the four initially failing scenario identities. Production TypeScript/CSS file timestamps were checked against the initial run; no application source changed between runs. Both run summaries and the per-scenario evidence mapping are retained in `artifacts/release-e2e-verification.json`; the manifest does not present this as a single clean full run. The intermediate stale-inventory/old-fixture unit failures were corrected before the complete passing unit repeat. No tests were skipped to obtain the passing totals.
