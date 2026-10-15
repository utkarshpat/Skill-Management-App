# Documentation index

Updated: 15 October 2026. Read the current handover before older dated reports. Documentation describes repository behavior and dated acceptance, not continuous production health or enterprise certification.

| Reference                                                                                     | Purpose                                                                                               |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [Project handover](HANDOVER.md)                                                               | Current release, implemented flows, architecture, operations, remaining work and temporary KT removal |
| [Approved access baseline](ACCESS_MODEL_REDESIGN.md)                                          | Authority for access constraints; effective server/SQL checks remain canonical                        |
| [Production E2E — 15 October](PRODUCTION_E2E_2026-10-15.md)                                   | Runtime `e0fa9a3`, 73 lifecycle checks, live AI, role matrix, browser acceptance and exact limits     |
| [Evidence production acceptance](EVIDENCE_PRODUCTION_ACCEPTANCE_2026-10-14.md)                | Installed migration 084, private large-file transport and hosted evidence rollout                     |
| [Evidence operator runbook](EVIDENCE_READINESS_2026-10-14.md)                                 | Dry-run inventory, retention decision, coordinated recovery and remaining operational checks          |
| [Organization onboarding/SSO](ORGANIZATION_ONBOARDING_AND_SSO_REQUIREMENTS.md)                | Deferred organizational integration prerequisites                                                     |
| [Directory integration boundary](EMPLOYEE_DIRECTORY_INTEGRATION.md)                           | Stored employee provider and future upstream adapter without authority drift                          |
| [Azure migration runbook](AZURE_MIGRATION_RUNBOOK.md)                                         | Environment migration, data/files, runtime identity, rollback and acceptance                          |
| [FDD reporting follow-up](FDD_REPORTING_INCREMENT_2026-10-14.md)                              | Full catalogue coverage, distinct credential holders and global ranking                               |
| [Conversational people matching](CONVERSATIONAL_PEOPLE_MATCHING_2026-10-14.md)                | Existing AI sidebar, clarification, current authorized results/export and removed demand UI           |
| [Renewal/notifications/learning](RENEWAL_NOTIFICATIONS_AND_LEARNING_NEXT_STEPS_2026-10-13.md) | Approval-gated renewal lineage and explicit catalogue-based learning next steps                       |

`SCMD_FDD_MAPPING_2026-10-12.md` and the dated audit files preserve findings at their review date. Later increments and acceptance records supersede their “missing”, “local” and “pending” statements only for the features actually covered. They must not be used as a new backlog without checking the current handover.

## Interactive knowledge transfer

The authenticated `/knowledgetransfer` reader and its source-grounded guide use `apps/api/src/modules/knowledge-transfer/content.generated.ts`. Edit the maintained handover/access/runbook inputs, then run:

```powershell
npm run docs:generate
npm run docs:check
```

The same generator updates `REFERENCE.generated.json` from reviewed repository migrations/routes. It never introspects live data or imports credentials. A generated schema inventory does not prove that another environment has those migrations installed. The guide is documentation-only and cannot inspect employee records, grant access or execute business actions.

## Deferred and unverified

Organization hosting/SSO/directory synchronization and scheduler activation remain deferred. Retention is dry-run only. Real account-wide storage inventory, coordinated SQL/file restore, native unload/drag-drop, isolated simultaneous browser sessions and hosting load/fault tests require separate evidence. Manual manager approval does not establish issuer authenticity. See the E2E report for the exact tested boundary.
