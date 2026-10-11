# Access profile consolidation — 11 October 2026

User-approved labels are **Employee**, **Manager**, **Business Analytics** and **Admin**. These are four access profiles; they are not a role hierarchy. Employee and Manager are automatic policy sources, while Business Analytics and Admin are explicit scope-bound responsibilities. Renaming a permission template cannot grant business authority.

## Applied account configuration

Applied and verified on the configured `skill-management-dev` account at access revision 241:

| Person/group            | Access                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| All 17 active people    | Employee baseline, subject to explicit DENY                                               |
| Utkarsh Patel           | Explicit Admin and explicit organization Business Analytics                               |
| Anupriya Banerjee       | Explicit Business Analytics bound to UK, her current Delivery Unit                        |
| Current direct managers | Manager policy for current direct reports; exact assigned-reviewer/workflow checks remain |
| Other people            | Employee only; no Business Analytics or Admin                                             |

Four people currently have relationship-derived Manager access: Utkarsh Patel, Hemant Navlakha, Mukesh Rajput and Vivek Seth. Utkarsh's current direct report is the QA test person. Reporting records were not changed by this consolidation.

Anupriya can see 14 active UK members rather than all 17 account members. Her grant stays bound to the selected UK node; a future placement change does not silently create a new delivery-unit grant. An administrator must preview and update the binding.

All nine old permission templates and their person assignments were explicitly retired at the user's request. Before/after template definitions and assignments are retained in `AccessAudit` under `access.templates.retired`; an operator backup was also saved locally. There were no template DENY grants. Both individual exceptions were preserved unchanged. New responsibilities used the existing restricted-runtime preview/recheck/transaction/audit path. Retirement used a verified existing Microsoft-linked administrator, a revision lock, a rollback preview and post-change access checks in the same SQL transaction.

## Administration

Open **People & Access → Manage access profiles**, or `/business?tab=administration`.

- Search people by name or employee code; inspect automatic access and explicit assignments together.
- Select **Add access** to create a separate scoped assignment, or select an existing assignment to edit/deactivate it.
- Business Analytics supports the implemented Organization, Delivery Unit, Department and Project bindings. Admin is Organization only.
- Select effect, state and expiry; a DENY requires expiry. Explain the change, preview current/proposed values, then confirm.
- The API regenerates the preview receipt and SQL rechecks current authority, revision, bindings and administrator retention before saving. Existing matching DENY and assigned-current-manager review constraints continue to apply.
- Reporting/placement, individual exceptions, effective-access explanations and audit history remain available from People & Access. Projects and memberships have separate administration sections.

Migration 067 extends the existing authorized administration read with effective Employee/Manager/Business Analytics/Admin flags. These use current SQL policy, including profile prerequisites and DENY. No UI label creates authority. Legacy preset discovery now contains the four approved names; the two business profiles route to scoped administration and are deliberately not created as empty permission templates by the provisioning CLI.

## Verification

- All 17 active users retained personal claims, learning and request access through the canonical runtime projection.
- Runtime workspace discovery: 4 Managers, 2 Business Analytics users, 1 Admin, 0 legacy templates.
- Anupriya's runtime dashboard total matched SQL's UK member selector (14); she cannot manage access.
- New rollback SQL fixture verifies reporting-derived Manager without a template and suppresses Employee/Manager/analytics discovery after a profile DENY.
- Existing business API tests cover current scope, forged selectors, stale preview receipts, DENY, revocation and administrator constraints.
- Hosted normal-demo API checks passed for Anupriya, Hemant and Khushi: personal workspace returned 200 for all; only Anupriya could load Business Analytics (14 UK members); Manager discovery remained limited to Hemant among these three; all three were denied access administration (403).
- Commit `78fb62d` was pushed to main. Hosted asset verification confirmed the four profile labels, administration entry and readable current/proposed access preview in the deployed bundles. This is deployment verification, not an administrator browser interaction test.

Database verification does not substitute for an actual Microsoft SSO administrator browser acceptance run. That real-login verification remains deferred by the user. Migration 065/scheduler activation remains deferred for the future organization host.
