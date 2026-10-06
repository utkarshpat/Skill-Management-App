# Cognitive Intelligence Lab

Permission-driven workforce capability and learning platform. React/TypeScript + Vite frontend, modular Express API and restricted Azure SQL procedures. Node 24; dependencies pinned in `package-lock.json`.

## Project reference

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
- Published skill definitions, personal claims and current assigned direct-manager reviews with no self-review.
- Team capability analytics and recommendations; acceptance leads to an explicitly reviewed learning plan, never automatic verification.
- Manager **Report** menu in the Team members header downloads a self-contained interactive HTML report (KPIs, coverage/gap bars with level switch, sortable and searchable gap table, claim-status donut, level distribution, skill radar, level mix, category share, print/PDF) or Excel-compatible CSVs (team summary, reviewed coverage, recorded coverage gaps). Reports omit names, employee IDs and identifying search text; small filtered cohorts can still be identifying. Search defines the report scope; chart filters and roster pagination do not. Export rechecks current access and reloads aggregates. Coverage shortfalls are not skill deficiencies or role-based target gaps; skills without any reviewed records are excluded.
- Team analytics adds KPI strip, team skill radar, recorded-gap chart, level mix by skill, member × skill heatmap (current page), category treemap and claims-per-member chart. **Ask AI about gaps and demand** sends a manager's typed demand (skill, minimum level, headcount) to the assistant, whose `team_skill_gaps` tool compares it with current active direct reports' manager-reviewed claims only. Demand is conversation-only and never stored; the tool is offered only to managers with assigned review authority and rechecks access before answering.
- Personal dashboard shows up to six highest-level manager-reviewed skills with saved proficiency names, a compact spider-web chart and summary. One/two skills use a readable list until a meaningful radar is possible. Draft/pending claims and learning completion never populate reviewed proficiency.
- Learn & Grow plans/tasks, study logs, generated practice, progress and recovery; Growth Journey connects recommendations, skill-linked plans, employee-owned claims and assigned reviews without treating learning as proficiency evidence.
- Participant-scoped requests/incidents, searchable recipients, reassignment, resolution and notifications.
- Authorized dashboard cards, personal navigation ordering and contextual AI with bounded context, recent durable conversations and shared SQL request budgets.

Private compressed claim images are implemented and verified in the personal/demo deployment. File scanning, retention and delete/replace remain pending. Formal assessments, demand/matching and broader team/department/subtree grant scopes are not implemented. The handover records the dated 6 October 2026 Microsoft sign-in, SQL/runtime and image round-trip verification. A subsequent check on 6 October found Azure SQL paused after exhausting October's free quota; database-backed flows are currently unavailable until approved paid resumption or the 1 November quota renewal. This remains a personal/demo deployment; deferred login hardening and production prerequisites are documented in the handover.

## Verification and schema changes

```powershell
npm run docs:generate
npm run docs:check
npm run architecture:check
npm run typecheck
npm test
npm run build
npm run db:check -w apps/api
```

Python 3 generates the KT bundle from the maintained handbook, approved baseline, routes and migrations. Regenerate after changing those inputs; CI rejects stale output. `npm run db:migrate -w apps/api` applies reviewed outstanding migrations through 051 using a separate setup identity and one migration worker. Migration 041 supplies the complete actor-bound top-skills summary and each claim's saved definition scale; until it is deployed, the dashboard explicitly marks that snapshot unavailable. Migration 042 adds optional last-used dates to skill claims; deploy it before the corresponding form/API changes. Dates are employee-reported recency, not verified proficiency. Migration 043 adds the own organization/reporting profile projection; deploy it before the corresponding profile changes. It grants no wider visibility or authority. Migration 044 enforces Awareness, Foundation, Practitioner, Advanced and Expert for new/changed catalogue definitions without rewriting history. After deploying it, preview existing dummy-data alignment with `npm run catalogue:seed -w apps/api -- --align-existing`; add `--apply` to commit the reviewed rank-preserving mappings atomically. Migration 045 adds administrator-maintained business job title and grade, with preview/recheck/audit and read-only own-profile display; these descriptive fields grant no authority. Deploy it before the corresponding profile/editor changes. Migration 046 fixes OWN skill-view enforcement on claim reads; 047 provides bounded own learning-journey claim status. Apply both before deploying the corresponding journey changes. Migrations 048/049 add actor-bound access reads and paginated audit without colliding with dev1 041/042. Inspect opt-in integration fixtures before running them against live SQL; ordinary tests do not require SQL or model credentials. Never run seed/import scripts as ordinary startup tasks.

Migration 051 restricts reviewer image evidence to uploads audited before the claim's latest submission. New uploads on returned/rejected claims remain owner-only until resubmission; existing submitted images remain available under current assigned-manager policy. Existing images/audit history are not rewritten. Apply 051 before deploying the corresponding visibility guidance. `npm run test:evidence-snapshot -w apps/api` exercises the procedure in rollback-only setup-identity fixtures, including resubmission and denial cases; it requires schema through 050 and makes no Blob writes. This code change does not establish live migration or deployment acceptance.

## Hosting and temporary KT removal

Root `vercel.json` deploys services `api` (public `/api` and `/api/*`) and `web` (remaining paths) on one domain. No internal bindings are needed: browser requests use same-origin API routes. Main-branch pushes trigger deployment; verify Ready for the exact commit and smoke-test the hosted workflows.

KT is isolated in `apps/web/src/knowledge-transfer` and `apps/api/src/modules/knowledge-transfer`. Set **`KNOWLEDGE_TRANSFER_ENABLED=false`** in API deployment configuration and redeploy to disable its protected reader/AI endpoints. Removing it needs no SQL rollback, data deletion, new grants or core chat changes. Follow the handover's **Temporary Feature Removal** checklist and retain the permanent documentation.

[Repository](https://github.com/utkarshpat/Skill-Management-App) · [Application](https://skill-management-app.vercel.app)
