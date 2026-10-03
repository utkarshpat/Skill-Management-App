# Architecture: separate frontend and modular monolith API

## Decision

Keep one repository with a React frontend in `apps/web` and one Express backend in `apps/api`. The backend is a modular monolith: its business modules run in one Node process, communicate through explicit TypeScript contracts, and share the existing Azure SQL database. Modules do not require separate services, hosts, network calls or databases.

Frontend/backend separation and backend modularity are complementary decisions. The web app calls `/api/*` through HTTP; it cannot import backend source or database adapters. The root vercel.json configures Vercel Services to build api and web separately behind one origin. The static frontend's calls originate in the browser, so no internal service binding is needed. The backend remains one modular monolith, not separate microservices. See VERCEL_DEPLOYMENT.md for runtime entrypoints, cloud setup and verification limits.

## Source ownership

```text
apps/
  web/                       React UI and Microsoft SPA sign-in
  api/src/
    server.ts                Runtime configuration and adapter construction
    app.ts                   Middleware, route composition and error handling
    modules/
      identity/              Token verification, own profile and dev sessions
      access/                Permission policy, roles, overrides and access stores
      organization/          Organization structure and reporting-line policy
      skills/                Catalogue validation and proficiency definitions
      ai/                    Read-only assistant, tools and model adapters
    shared/
      database.ts            Restricted SQL connections and connection lifecycle
      errors.ts              Shared HTTP-aware application error
      http-security.ts       Loopback and development-origin validation
database/migrations/         Reviewed schema, procedures and transactional rules
scripts/                     Architecture enforcement and its regression tests
```

Each module owns its `routes.ts`. Its `index.ts` is the public contract used by other modules. Cross-module imports of private files, SQL stores or HTTP route implementation are rejected. `server.ts`, `app.ts`, administrator CLIs and tests can import implementation files when they construct or verify the app.

Identity exposes validated identity/profile contracts and development sessions. Access exposes permission checks, access-store contracts and editable preset definitions. Organization exposes hierarchy/reporting contracts. Skills exposes catalogue contracts. AI exposes the assistant service/provider contracts. These exports are deliberate; adding a dependency requires review rather than widening every index to export all files.

Organization and Skills keep validation and types in their domain files and SQL persistence in `sql-store.ts`. Access already has separate SQL and local implementations; the SQL implementation continues reusing local access validation before its transaction rechecks authority and revision. The shared database layer manages connections only. Business SQL remains in the owning module's adapter and reviewed procedures.

## Dependency rules

| Module | Allowed runtime module dependencies | Additional type-only dependencies |
| --- | --- | --- |
| Identity | Access | None |
| Access | None | Identity |
| Organization | Access | None |
| Skills | Access | Identity |
| AI | Access, Organization, Skills | Identity |

Shared infrastructure cannot import modules or bootstrap files. Modules cannot import `app.ts`, `server.ts`, administrator CLIs or frontend implementation. The runtime module graph is acyclic; type-only identity references are erased during compilation. SQL, cryptography and provider SDKs remain normal external dependencies.

`npm run architecture:check` checks source imports, re-exports and literal dynamic imports against this graph. Computed imports are rejected so dependencies remain reviewable. This is a source dependency guard, not a security sandbox or a complete TypeScript parser. Strict type checking and HTTP/policy tests remain required alongside it. Guard regression tests include private import attempts, runtime cycles, missing targets and frontend/backend coupling.

## Request flow and trust boundaries

`server.ts` builds the configured stores and provider, then passes those dependencies to `createApp`. `app.ts` installs Helmet, request IDs and the existing bounded JSON parser, creates the development session service when explicitly enabled, and registers the module routes.

Access middleware must run before Organization routes because `/api/access/organization` inherits the Microsoft permission-administration gate. Organization additionally requires current people-administration permission and rejects requests when the authenticated access context is missing. A regression test verifies that mounting Organization without Access cannot read or write records. Skills and AI retain their independent permission checks and server-derived actors.

API paths, response shapes, cookies, development-only restrictions, Microsoft verification, explicit DENY behavior, live revocation and revision/audit rules are preserved. No database migration is required for this refactor. Administrator command filenames stay at the API root, preserving migration paths and the existing npm commands. AI tools remain read-only; a live model is still unconfigured until credentials are supplied separately.

## Verification and further work

Run from the repository root:

```powershell
npm.cmd ci
npm.cmd run architecture:check
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

The refactor was verified with architecture guard tests, API/policy tests, strict frontend/backend types and both builds. Live Azure SQL integration tests were not rerun for this source-only refactor; migrations and SQL procedures were unchanged. The existing opt-in `test:organization`, `test:catalogue` and `test:sql` commands remain available with the updated adapter imports.

Own claim drafts now belong to Skills, with domain validation, SQL adapters and authenticated routes; AI consumes the public ClaimsStore contract. Evidence, submission, review and learning are future workflows. Add owned modules when their behavior and authorization are implemented. Company migration still needs approved tenant/runtime identity, network configuration, monitoring, readiness, operational controls and deployment verification. Modular structure alone does not establish production readiness.
