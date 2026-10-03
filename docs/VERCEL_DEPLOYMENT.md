# Vercel Services deployment

## Confirmed configuration

The root vercel.json defines one Vercel project containing two independently built services:

| Service | Root | Framework | Public ingress |
| --- | --- | --- | --- |
| api | apps/api | Express | /api and /api/* |
| web | apps/web | Vite | Remaining paths, including / |

The API retains the original /api prefix. No prefix stripping, cross-origin browser URL or client-selected backend host is needed. The bare /api rule prevents it from falling through to the SPA. The web service rewrites known client routes to index.html, while assets and Vite development modules remain files. Build commands and output settings belong to services, not the top level.

### Call graph and bindings

The web service builds static browser code; its fetch('/api/...') calls originate in the browser and use the deployment's public route table. It has no server-rendered functions that call the API. The API does not call web or another repository service. SQL and Gemini/Microsoft are external integrations, not Vercel services. There are therefore no service-to-service bindings in this configuration. The standalone Vite localhost proxy is only for npm run dev and is disabled under Vercel.

If a server-side caller is added later, declare its binding on that caller with type=service, service=<target>, format=url and env=<generated variable>. Read that variable only in a runtime function. Do not set it manually, expose it as VITE_*, resolve it during the build or use it in middleware. A binding does not replace application authentication/permissions.

## Runtime entrypoint

apps/api/app.ts imports the configured Express app from src/server.ts. The function explicitly includes the root package.json so bundled JavaScript retains ESM semantics. The dependency-injected factory is named src/create-app.ts to avoid a generated app.js name collision with the deployment entrypoint. Its explicit Express import makes framework detection choose the root entrypoint instead of the factory, which is a dependency-injected factory. src/server.ts exports the app and lets Vercel own the listener/lifecycle when VERCEL=1. Normal Node hosting keeps the listener and graceful shutdown; HOST can be set to 0.0.0.0 for a future Azure container/service. No migrations, seed imports or local file writes run at request startup.

## Local verification

From the repository root, using Node 24:

```powershell
npm ci
npx vercel@62.2.0 dev -L --listen 5174
```

The -L flag runs both services without cloud login. The 5174 port leaves the existing 5173 development app available. Root .vercel/ resources are ignored in Git; .vercelignore also excludes local environment files and build outputs from CLI uploads.

GET /api/health checks the routed Express app, not SQL readiness. /preview checks the frontend and assets; /my-skills checks a direct SPA URL. With no cloud credentials the API must deny protected endpoints. The frontend's local Microsoft redirect may still point to 5173; do not claim a Microsoft login test on 5174 unless that exact callback is registered/configured.

## Cloud setup after configuration confirmation

Import utkarshpat/Skill-Management-App in the user's Chrome as one multi-service project. Keep the project root at the repository root, not apps/api or apps/web. Refresh service configuration after the reviewed config commit reaches main. Stay on the existing Hobby plan for personal evaluation; do not start a paid trial or enable paid networking automatically.

Set environment variables through Vercel project settings. Shared project variables must not be copied into frontend output. Only the following are intended for the web build:

- VITE_ENTRA_TENANT_ID, VITE_ENTRA_WEB_CLIENT_ID, VITE_ENTRA_API_CLIENT_ID.
- VITE_AUTH_REDIRECT_URI: the exact stable deployed HTTPS origin followed by /, or omit it to use window.location.origin + '/'. Never deploy the local 5173 callback value.

API runtime variables:

- NODE_ENV=production; DEV_DIRECT_LOGIN=false (or omitted). Local passwordless test-person login remains loopback-only. The separate gated hosted demo option is described below.
- ACCESS_ACCOUNT_ID; ENTRA_TENANT_ID, ENTRA_WEB_CLIENT_ID, ENTRA_API_CLIENT_ID.
- AZURE_SQL_SERVER, AZURE_SQL_DATABASE; AZURE_SQL_RUNTIME_AUTH=client-secret; AZURE_SQL_CLIENT_ID and secret AZURE_SQL_CLIENT_SECRET. Preserve the restricted SQL runtime identity and procedure-only grants. Vercel is not an Azure managed-identity host.
- GEMINI_API (secret), with optional AI_PROVIDER/AI_MODEL settings. Never prefix model credentials with VITE_. Other provider settings follow AI_INTEGRATION.md.

Register the stable Vercel HTTPS callback in the Microsoft SPA registration while retaining the existing local callback. Preview domains are separate callbacks; do not add wildcard redirects or connect arbitrary branch previews to the development database. Use production-scoped runtime secrets initially unless a separately approved preview environment exists.

Azure SQL firewall connectivity must be verified from hosted runtime. Vercel Hobby outbound IPs are dynamic; the current laptop firewall allowance alone does not establish hosted connectivity. Do not open the full SQL IPv4 range, remove current rules or enable paid static-IP features automatically. Agree on the concrete network option if the deployment is blocked.

The API's in-memory AI request counters/concurrency locks are per instance, not shared quotas or a guaranteed monetary cap. SQL conversation storage remains durable and actor-scoped. Shared budgets/locks, operational readiness/monitoring and completion of business workflows remain company production work.

## Temporary hosted demo

Hosted demo is explicitly enabled with HOSTED_DEMO_LOGIN=true, PUBLIC_APP_ORIGIN=https://skill-management-app.vercel.app (no trailing slash), secret DEMO_LOGIN_ACCESS_CODE (at least 4 characters; short evaluation code supported at the owner’s request), and secret DEMO_SESSION_SECRET (at least 32 characters). These are production-scoped server variables; never expose them through VITE_* or commit them. The access code for this evaluation is stored locally in ignored .local/hosted-demo-access.txt.

Anonymous discovery exposes only the locked gate, not the people roster. Enter the shared code and select Show test people before choosing an active person. Microsoft-linked people, including the account owner, cannot be impersonated. All application authorization continues to use that person's current permissions and account scope. Requests must match the configured host; mutations also require the exact HTTPS Origin.

Hosted sessions use a signed, Secure, HttpOnly, SameSite=Strict cookie with a 30-minute lifetime so they survive serverless instance changes. Logout clears the browser cookie; a copied token remains valid until expiry or access-code/session-secret rotation. Shared demo identities share their existing business records and actor-scoped chat history. This is temporary personal evaluation access, not company authentication. Set HOSTED_DEMO_LOGIN=false and redeploy to remove it before company rollout.

The theme defaults to light when no valid saved preference exists; explicit dark/system preferences are preserved. Interactive acceptance checks now run on the deployed HTTPS application in the user's Chrome. Automated type, build, architecture and security checks still run before deployment.

## Verification record

On 2026-10-03, deployment 3HHjAZvz7qovN3goJrNJGHQftaWi from commit 840fb78 reached Ready in 21 seconds. Migrations 010–012 are applied to the personal Azure development database. Seeding created 70 published enterprise skills, 350 specific criteria and one shared five-level framework atomically; a subsequent plan reported zero creates and 70 preserved codes. The catalogue shows 71 published records including the explicitly named synthetic QA Skill Review Workflow fixture. The user's Chrome verified Java SKL-001, its supplied definition and Intermediate criteria, blank-search discovery and the five-level catalogue view.

Chrome business acceptance used only the synthetic QA claim: Khushi saved project/evidence references, submitted to Hemant, received request-changes feedback and notification, edited/resubmitted, then received approval and its notification. Hemant's assigned queue returned to zero after each decision; the approved employee claim had View only, with no edit or submit actions. Gemini retrieved the current actor's assigned review queue and correctly identified only this pending synthetic claim before approval. SQL rollback tests additionally verified rejection, foreign/self review denial, stale/double decisions, current manager/permission enforcement, historical criteria retention and shared-level reuse. All 92 automated checks (5 architecture, 74 API, 13 web), strict types and production builds passed. The review/catalogue rollout also fixed misleading draft labels and empty SQL search results.

Evidence screenshots are local ignored artifacts: .local/enterprise-java-production.png, .local/assigned-review-ai-production.png and .local/approved-skill-production.png. The synthetic QA skill/claim remain visibly labelled for evaluation; they are not actual employment evaluations. Learning, requests/incidents, attachment upload storage, reassessment of approved claims and matching/freshness scoring remain future workflows. This acceptance verifies the shipped increment, not company production readiness.

On 2026-10-03, commit 85be529 added the light default and gated hosted demo. Its first deployment started before PUBLIC_APP_ORIGIN was saved and returned an Invalid URL startup error. Redeploying with the complete production configuration as 4Cj6TCs2P2SNXzzKhD42i16YJnzB restored /api/health 200 and anonymous /api/dev-login 200 with an empty, locked roster. In the user's Chrome, an incorrect code was rejected, the correct code revealed 16 eligible test people with the Microsoft owner excluded, and Khushi's employee login loaded the dashboard, My skills and notifications. Her hosted AI request returned formatted skill-draft guidance; refresh restored the same employee session, and logout returned to the gate. Hemant's manager login loaded his own identity and a fresh assistant view without the employee's conversation. The first roster request exceeded the frontend timeout while SQL woke up; the retry succeeded. This cold-start UX limitation remains. Automated checks passed: 87 tests (5 architecture, 69 API, 13 web), types, builds and module boundaries.

The project was created on the existing Hobby plan at https://skill-management-app.vercel.app through the user's Chrome. The 15 allowlisted variables are production-scoped; preview deployments do not receive the runtime secrets. Microsoft SPA redirects include the stable HTTPS origin and retain http://localhost:5173/. The existing Azure SQL firewall was inspected and left unchanged. The initial cloud API bundle failed with missing ESM metadata and an app.js filename collision between the factory and entrypoint. Including package.json and renaming the factory to create-app.ts resolved both failures; changing only the entrypoint extension did not.

On 2026-10-03, deployment 2qKsPL9N5zo9cteMwwUcbWzZSirv from commit 5c772fe passed hosted smoke checks: /api/health 200; anonymous /api/profile, /api/my-skills and /api/assistant 401; /api/dev-login 404; /, /access?view=skills and /my-skills 200. In the user's Chrome, Microsoft sign-in returned to the HTTPS app and the Azure SQL dashboard loaded 17 people, 9 roles and 2 departments. The first workspace request timed out during cold startup; a retry succeeded. The notification panel loaded its empty feed. Two existing saved AI chats were listed, an existing conversation resumed, and Gemini returned a formatted answer to a no-write skill-draft question. No people, permission or skill records were changed during the smoke test; the AI test exchange was appended to the existing conversation.

Local Vercel CLI 62.2.0 detects both services. After fixing framework entrypoint detection and limiting SPA rewrites, the API health route returns HTTP 200 and the user's Chrome renders /preview with assets and a direct /my-skills login page. Public API endpoints remain authenticated; the disabled demo endpoint returns 404. All 83 checks (5 architecture, 66 API, 12 web), strict types, architecture boundaries and builds pass. The user confirmed api/web names, public routes, no bindings and project name skill-management-app before deployment. Main-branch pushes trigger automatic production deployments. These smoke checks validate hosting and existing functionality, not completion of the planned business workflows or company production readiness.

Official references: [Services](https://vercel.com/docs/services), [routing](https://vercel.com/docs/services/routing), [bindings](https://vercel.com/docs/services/bindings), [configuration](https://vercel.com/docs/services/config-reference), [Express entrypoints](https://vercel.com/docs/frameworks/backend/express), [database IP allowlisting](https://vercel.com/kb/guide/how-to-allowlist-deployment-ip-address).
