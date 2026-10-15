# Cognitive Intelligence Lab

Permission-driven workforce capability and learning platform. React/TypeScript + Vite frontend, modular Express API and restricted Azure SQL procedures. Node 24; dependencies pinned in `package-lock.json`.

## Current release — 15 October 2026

Runtime `e0fa9a3` is deployed on the temporary hosted demo. Local verification: 549 tests, typecheck and API/web build passed. Production acceptance: 73 lifecycle checks, four live AI turns and four demo-account access checks, plus employee/manager browser acceptance. See the [exact E2E coverage and limitations](docs/PRODUCTION_E2E_2026-10-15.md); this is not enterprise go-live sign-off.

Skills and certificates use one intake/review flow. Renewal replaces the visible current credential only after approval while retaining history. Analytics and conversational Find people use canonical server-enforced scope; catalogue amendments and People & Access administration are separate workspaces. Skill evidence supports PDF/images up to 10 MB; certificates retain a 5 MB limit. Retention is dry-run only. Organization hosting/SSO, directory synchronization, scheduler activation and actual recovery drills remain deferred.

The [documentation index](docs/README.md) identifies current references versus dated audit records. `/knowledgetransfer` is generated from the maintained handover, approved access baseline and runbooks; regenerate it with `npm run docs:generate` after edits.

## Project reference

- [Employee directory integration](docs/EMPLOYEE_DIRECTORY_INTEGRATION.md): provider boundary for current DB employee details and a future organisation API; preserves local identity, permissions and reporting authority.

- [Complete project handover](docs/HANDOVER.md): requirements, architecture, module ownership, workflows, AI, schema, deployment, testing, limitations and removal instructions.
- [Azure migration with data](docs/AZURE_MIGRATION_RUNBOOK.md): step-by-step free-offer eligibility, SQL export/import, private evidence copy, identity/runtime remapping, deployment, acceptance and rollback. A paused source needs a verified backup or must resume before full export.
- [Approved Access Management baseline](docs/ACCESS_MODEL_REDESIGN.md): mandatory policy for access-related changes. Approved target scopes are distinct from implemented enforcement.
- [Interactive knowledge transfer](https://skill-management-app.vercel.app/knowledgetransfer): authenticated temporary reader, searchable chapters, schema/FK explorer, API/SQL inventory and source-grounded AI guide.

The handover replaces obsolete topic documents. Source code, validators and migrations remain authoritative for exact contracts. The schema explorer reconstructs repository migrations; it does not introspect the live database.

## Local development

Copy `apps/api/.env.example` to ignored `apps/api/.env`, and `apps/web/.env.example` to ignored `apps/web/.env.local`. Configure matching Entra registrations, approved callback, account binding and restricted SQL identity using the handover. Never put SQL/provider secrets in `VITE_*` variables.

```powershell
npm ci
npm run dev
```

Web: `http://localhost:5173/`. API: `http://127.0.0.1:3001/api/health` (liveness only). Sign-in does not provision users or grant permissions. Local direct login requires the development-only opt-in; hosted demo is a separate temporary gated configuration.

## Implemented workflows

- Effective access explanations, People & Access, supported scoped templates/exceptions, reporting and audited preview/recheck changes.
- Administrator-maintained primary capability linked to a published catalogue skill, with read-only own-profile display and archived-selection warnings. Server-derived completeness checks exactly six work fields: name, employee ID, business job title, grade, valid department and published primary capability. Reporting manager remains separate; evidence, skill claims and access templates do not affect the score.
- Published skill definitions, personal claims and current assigned direct-manager reviews with no self-review.
- Team capability analytics and recommendations; acceptance leads to an explicitly reviewed learning plan, never automatic verification.
- Manager **Report** menu in the Team members header downloads a self-contained interactive HTML report (KPIs, coverage/gap bars with level switch, sortable and searchable gap table, claim-status donut, level distribution, skill radar, level mix, category share, print/PDF) or Excel-compatible CSVs (team summary, reviewed coverage, recorded coverage gaps). Reports omit names, employee IDs and identifying search text; small filtered cohorts can still be identifying. Search defines the report scope; chart filters and roster pagination do not. Export rechecks current access and reloads aggregates. Coverage shortfalls are not skill deficiencies or role-based target gaps; skills without any reviewed records are excluded.
- Team analytics adds KPI strip, team skill radar, recorded-gap chart, level mix by skill, member × skill heatmap (current page), category treemap and claims-per-member chart. **Ask AI about gaps and demand** sends a manager's typed demand (skill, minimum level, headcount) to the assistant, whose `team_skill_gaps` tool compares it with current active direct reports' manager-reviewed claims only. Demand is conversation-only and never stored; the tool is offered only to managers with assigned review authority and rechecks access before answering.
- Personal dashboard shows up to six highest-level manager-reviewed skills with saved proficiency names, a compact spider-web chart and summary. One/two skills use a readable list until a meaningful radar is possible. Draft/pending claims and learning completion never populate reviewed proficiency.
- Learn & Grow plans/tasks, study logs, generated practice, progress and recovery; Growth Journey connects recommendations, skill-linked plans, employee-owned claims and assigned reviews without treating learning as proficiency evidence.
- Participant-scoped requests/incidents, searchable recipients, reassignment, resolution and notifications.
- Authorized dashboard cards, personal navigation ordering and contextual AI with bounded context, recent durable conversations and shared SQL request budgets.

Ordinary PDF/image skill evidence, private previews and explicit evidence-to-certificate promotion are implemented. No file-scanning or destructive retention policy is claimed. Temporary demo authentication and company hosting readiness remain documented boundaries; dated migration/release notes below are historical and must be read with the current handover status.

## Verification and schema changes

Current shared-demo evidence schema is through migration 084, as recorded in the evidence acceptance report. Historical per-migration guidance below does not describe pending work on that verified target. New environments still need reviewed installation and separate acceptance; this documentation push applies no migrations.

Certification/skill writes use owner-bound SQL, assigned current-manager review, independent expiry, optimistic revisions and audit. The current shared-demo migration/acceptance record is [evidence production acceptance](docs/EVIDENCE_PRODUCTION_ACCEPTANCE_2026-10-14.md); future databases require their own verified migration and runtime grants. No migration or seed runs automatically at startup.

```powershell
npm run docs:generate
npm run docs:check
npm run architecture:check
npm run typecheck
npm test
npm run build
npm run db:check -w apps/api
```

Python 3 generates the KT bundle from the maintained handbook, approved baseline, runbooks, routes and migrations. CI rejects stale output. Use `npm run db:migrate -w apps/api` only for reviewed outstanding migrations against a verified target with a separate setup identity and one migration worker. Inspect opt-in SQL integration fixtures before execution; ordinary tests do not need SQL/model credentials. Never run seed/import scripts as ordinary startup tasks. Build and build-cache tests share API output, so run tests and builds sequentially.

## Hosting and temporary KT removal

Root `vercel.json` deploys services `api` (public `/api` and `/api/*`) and `web` (remaining paths) on one domain. No internal bindings are needed: browser requests use same-origin API routes. Main-branch pushes trigger deployment; verify Ready for the exact commit and smoke-test the hosted workflows.

KT is isolated in `apps/web/src/knowledge-transfer` and `apps/api/src/modules/knowledge-transfer`. Set **`KNOWLEDGE_TRANSFER_ENABLED=false`** in API deployment configuration and redeploy to disable its protected reader/AI endpoints. Removing it needs no SQL rollback, data deletion, new grants or core chat changes. Follow the handover's **Temporary Feature Removal** checklist and retain the permanent documentation.

[Organization onboarding & SSO checklist](docs/ORGANIZATION_ONBOARDING_AND_SSO_REQUIREMENTS.md) distinguishes the data request from implemented provisioning/import behavior and records the current redirect, identity and effective-access contract.

[Repository](https://github.com/utkarshpat/Skill-Management-App) · [Application](https://skill-management-app.vercel.app)

### Analytics and people matching

See the [implemented scope contract](docs/BUSINESS_OPERATIONS_DESIGN.md#implemented-increment-and-release-boundaries) together with the current handover. `/business` exposes authorized Analytics; Find people opens the existing AI sidebar for clarification, scoped matching and exports. Catalogue amendment creation/decisions belong to Skill catalogue; People & Access consolidates authorized administration. System Admin is an explicit responsibility independent of editable role names; none of these workspaces expands assigned-manager review authority.

Exports recheck current access and include all matching authorized rows up to 50,000, with spreadsheet-cell safety. AI never saves or approves a business action. Scoped responsibilities and baseline activation require reviewed admin preview/recheck/transaction/audit on each target; schema installation does not grant organization-wide Analytics. Historical installed migrations 060–061 are not outstanding work on the verified shared demo.
