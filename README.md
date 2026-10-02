# Skill Management App

React/TypeScript frontend, Node/Express API and Azure SQL. Laptop is the primary design view, with responsive phone layouts and supplied Sopra Steria branding.

## Local development

Use Node 24. Copy frontend/backend .env.example files into ignored apps/web/.env.local and apps/api/.env. Configure Entra and SQL as described in docs/SSO_AND_PROFILE.md. No secrets belong in the frontend.

```powershell
npm.cmd ci
npm.cmd run dev
```

Open http://localhost:5173/ for the registered Microsoft sign-in redirect. GET http://127.0.0.1:3001/api/health is liveness only. Public /preview shows the planned layout without employee records.

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run db:check -w apps/api
npm.cmd run db:migrate -w apps/api
```

Database setup uses the developer's Azure identity, applies reviewed migrations and closes connections. Migration 001 manages its own transaction; the runner skips an initialized schema and transactionally applies outstanding migrations 002/003. Use a single migration worker. Runtime SQL uses a separate restricted identity.

## Current scope

Temporary local direct login and permission administration are available when NODE_ENV=development and DEV_DIRECT_LOGIN=true. Choose Development Super Admin / DEV-ADMIN, then Access administration. Define custom role names, people IDs, role permissions and per-person ALLOW/DENY overrides. Configuration now persists in account-scoped Azure SQL tables with transactional revision checks and audit. Set ACCESS_ACCOUNT_ID after the explicit access:import operation. Production must leave this flag off. See docs/PERMISSION_ADMINISTRATION.md for scope, tests and the company migration boundary.

Microsoft SPA/API registrations, validated delegated tokens, restricted SQL own-profile access and a responsive authenticated profile page are implemented. Missing membership is denied; sign-in does not automatically onboard employees. The complete browser login and live Azure SQL profile retrieval succeeded after user-completed individual consent. Migrations 1, 2 and 3, historical role seeds and custom access records are verified in the personal development database. Verification details are in docs/SSO_AND_PROFILE.md.

The personal development workspace contains one explicitly provisioned test member with EMPLOYEE role. Skills, evidence, review, onboarding, AI tools and production deployment are upcoming increments. This development foundation is not yet production-ready.

## Documentation

- docs/BUILD_PLAN.md: agreed workflows and delivery sequence.
- docs/UI_DESIGN.md: laptop-first branding and responsive design.
- docs/AZURE_SETUP.md: Azure setup and company migration.
- docs/SSO_AND_PROFILE.md: sign-in, runtime SQL isolation and verification.
- docs/IDENTITY_AND_ACCESS.md: scoped roles, grants and N+1 policy.
- docs/PERMISSION_ADMINISTRATION.md: custom roles, per-ID overrides and local direct login.
- docs/AI_INTEGRATION.md: internal tools, policy gateway and exact write approvals.
- docs/ENGINEERING_STANDARDS.md: implementation, verification and deployment gates.

Source is under apps/web and apps/api; reviewed SQL is under database/migrations. CI checks strict types, tests and builds. Dependencies are pinned in package-lock.json. Optional external Google Fonts have local font fallbacks. The supplied mark was PNG despite its original .svg extension and is stored with the correct .png extension.

Repository: https://github.com/utkarshpat/Skill-Management-App
