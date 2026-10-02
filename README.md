# Skill Management App — Steps 01–02

Custom React + TypeScript frontend and Node.js + Express API. Azure SQL and Blob Storage are the planned persistence services.

## Run locally

Requires Node.js 22.12+ (Node 24 is installed on this machine).

```powershell
npm.cmd install
npm.cmd run dev
```

Open http://127.0.0.1:5173. API liveness: http://127.0.0.1:3001/api/health.

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

## Folder map

- `apps/web/src/App.tsx`: frontend shell and actual API connection check.
- `apps/web/src/styles.css`: desktop layout and responsive styles.
- `apps/web/vite.config.ts`: development API proxy.
- `apps/api/src/app.ts`: HTTP app, public liveness, closed protected paths and structured errors.
- `apps/api/src/server.ts`: local server startup/shutdown.
- `apps/api/test/app.test.ts`: health, unauthorized access and malformed JSON verification.
- `docs/BUILD_PLAN.md`: agreed direction and next steps.
- `database/migrations/001_identity_authorization.sql`: Azure SQL identity/access schema.
- `apps/api/src/domain/authorization.ts`: scoped permission and N+1 routing helpers.
- `docs/IDENTITY_AND_ACCESS.md`: integration rules, migration instructions and pending setup.

Only the overview and connection check are available in the UI. Module buttons are visibly disabled. Step 02 adds an SQL migration and tested permission/N+1 functions; these are not yet wired to authentication, HTTP or a live database. Protected API paths deny access. API liveness does not imply database readiness.

Vite serves the frontend locally; Express serves the API. Vite's `/api` proxy sends browser requests to Express so the frontend uses relative URLs. Production hosting/proxy and environment configuration will be added in a later step. The API binds to loopback for this local foundation.

Dependencies are resolved and locked in `package-lock.json`. Use `npm.cmd ci` for reproducible reinstalls. External Google Fonts are optional: CSS falls back to local sans-serif fonts.

## Next step: identity and data foundation

Validate and apply the prepared migration, then connect organizational identity using validated server-side tokens. Azure tenant/application identifiers and database access will be needed to validate real integration. Never trust user IDs, roles or manager IDs supplied by the browser as authority.

GitHub repository: https://github.com/utkarshpat/Skill-Management-App
