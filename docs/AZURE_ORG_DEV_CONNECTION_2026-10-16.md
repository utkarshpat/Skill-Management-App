# Organization development connection — 16 October 2026

## Latest rollout update — 17 October 2026

This update supersedes the earlier preparation/pending statements below for completed operator steps. The operator reports installing migration 085 (expected total 84 migration records; 065 is absent), retaining the 16 imported development people excluding Vimmi, setting `STORAGE_IS_SQL=true` and manually deploying `skills-appservice-9c85260489af.zip`. Package SHA-256: `9c85260489af8347588fc0a2d160b505163a18e0217b9cb2cf906dee81c477cb`. This source ZIP includes uncommitted changes based on `003ad3d`; it is not proof of a committed release identity or of the exact files running on the server.

Independent HTTP smoke checks after deployment returned 200 from `/`, `/api/health` and `/api/dev-login`, each in approximately one second. Demo discovery returned `requiresAccessCode=true`, `signedIn=false` and an empty people list. Earlier homepage errors/timeouts were observed and then cleared on retry; the cause was not established. Authenticated SQL upload, View/Download after page reload, review and Analytics acceptance remain pending. Microsoft employee SSO, AI resource provisioning, Redis, backup/restore acceptance and file cleanup remain separate work. Original testing hosting/database are retained.

## Approved inputs and verified boundary

### Operator-confirmed progress — 17 October 2026

The user explicitly selected **schema only**, excluding historical dummy data. SSMS output confirmed server `ssskillmgmtappsqlsrvdev`, database `SS-SkillMgmtApp-SQL-Dev`, 83 migration records and latest version 084 (065 is absent from the repository manifest). The runtime database principal exists as `EXTERNAL_USER`; its SID was provisioned using the operator-confirmed managed identity Application/client ID. `WITH OBJECT_ID` creation with an unrelated alias and subsequent external-user renaming were rejected; use the documented `CREATE USER ... WITH SID ..., TYPE = E` path with the verified **client ID**, not the managed identity object ID. Do not add broad database roles.

The fresh workspace bootstrap produced account `0ABD9BD3-7A7E-47B2-BEA2-EFBB86110CFA`, tenant `8b87af7d-8647-4dc7-8df4-5f69a2011bb5`, revision 1, baseline disabled and an explicit runtime-account binding. The user confirmed setting `ACCESS_ACCOUNT_ID` and managed-identity SQL settings. No employee, initial app administrator, catalogue or claims have been provisioned. This is operator-supplied evidence, not an agent-authenticated SQL/runtime acceptance.

The application origin is `https://ssskillmgmtappwebappdev-dugxhfchcbhsc3gv.uksouth-01.azurewebsites.net` (no trailing slash). The user reports successful liveness after removing the incomplete `ENTRA_TENANT_ID` environment setting. Tenant/API/web authentication IDs must be configured together; database tenant metadata remains intact. Liveness does not establish SQL authentication.

Demo-only composition now retains feature dependencies when an explicitly enabled temporary login store exists, while its bearer verifier rejects all tokens unless genuine Entra configuration is present. Existing cookie origin, access-code, active-person and authorization policies continue to enforce each request. Deploy the updated artifact before enabling temporary login; initial administrator bootstrap and hosted acceptance remain pending. No dummy Entra registration IDs or personal source-data import are required.

The user subsequently replaced the proposed single temporary administrator with an explicit import of **existing dummy people, access assignments and reporting relationships, excluding Vimmi**. Fresh read-only source snapshots at revision 772 agreed: 17 people, five organizational nodes, 15 manager links, two overrides and three explicit responsibilities; no role templates remain. Vimmi (`DEMO-NHS-015`) has no direct reports. The generated ignored `artifacts/org-dev-demo-people-import.sql` defaults to preview, then rechecks the exact fresh target/revision/runtime binding before applying 16 people, their placement/reporting, the source personal baseline and preserved explicit scoped responsibilities. It copies no employee Entra object IDs, primary-skill references, claims, certificate files or historical audit events. It records the reviewed import payload/hash, source revision and SQL operator in a new target audit event. Unsupported override scopes, invalid reporting or altered target state abort the transaction. The older single-admin artifact is explicitly superseded and disabled. Target execution and hosted login acceptance are still pending.

The demo-only composition release artifact is `skills-appservice-24ba8045c26b.zip`, SHA-256 `24ba8045c26ba10ac27be2ee6350a2848cab05eb0fb07c0d2c6907e070f1389d`, containing the uncommitted hosting changes. Full API suite: 326 passed; architecture/packaging: seven passed; API typecheck and frontend/API builds passed. Operator-side deployment and settings must be checked separately.

The user supplied a portal screenshot showing SQL database `SS-SkillMgmtApp-SQL-Dev`, SQL server `ssskillmgmtappsqlsrvdev`, App Service `SSSkillmgmtAppWebAppDev` and an App Service plan in UK South. Names must be confirmed against the actual subscription/resource group before executing deployment commands. The user explicitly approved UK South **for development**. This does not change the India-only production proposal.

The user relayed the organization's instruction to store certificates in database binary columns instead of requesting Blob Storage. This is an attachment-backend change, not something changing SQL connection settings implements. Existing code and historical hosted data still use Blob-backed files; no file migration, deletion, database migration or Azure deployment was performed in this preparation.

**Release strategy clarified by the user:** retain the existing personal/Vercel deployment and its database as the testing environment. Organization Azure releases are **manual**; there is no organization DevOps/CI/CD integration to assume exists. Do not decommission the old setup, freeze its writes for a cutover or continuously replicate the two databases. A one-time transfer of explicitly approved source data is separate from promoting application code. Existing repository checks/testing automation may remain in place without authorizing automatic organization deployment.

The available Azure CLI context lists only the previous subscription. A targeted read for the supplied App Service returned no resource in that context. Portal login does not establish CLI access. Organization tenant ID, subscription ID and full resource-group name are required, followed by interactive organization sign-in. Never paste keys, passwords or access tokens into chat or Git.

## Implemented hosting preparation

- Root `npm start` starts the built API workspace.
- `SERVE_WEB=true` opts into serving `apps/web/dist` from the API process under one origin; the build must exist or startup fails.
- API authentication/fallback runs before public static/SPA handling. Missing assets and POST requests are not rewritten into successful HTML responses.
- SPA navigation returns no-store HTML. Hashed Vite assets can be cached; unversioned public files revalidate.
- Browser CSP explicitly allows Microsoft identity connections/frames and local/blob PDF workers while retaining Helmet defaults.
- The platform `PORT` is already supported. `WEBSITE_HOSTNAME` selects external listening (`0.0.0.0`) unless an explicit `HOST` is supplied; local defaults stay loopback.
- Vercel/API-only behavior stays opt-in compatible. Tests exercise hosted routes, API denials, missing assets, sensitive dotfiles, cache headers and absent build handling.

This is local preparation, not evidence of an App Service deployment, real SSO or SQL connectivity.

## Organization App Service/SQL setup

1. Sign in to the approved organization tenant/subscription explicitly; inspect the exact web app's operating system, runtime, default hostname, identity and network path. The same-origin Node startup described here targets Linux App Service. Windows hosting needs its own verified startup configuration.
2. Build both workspaces with the organization SPA/API registration IDs supplied as **build-time** Vite configuration. Set `VITE_AUTH_REDIRECT_URI` to the exact approved HTTPS origin and register the same SPA redirect in Entra. These IDs are public configuration; API secrets are never Vite settings.
3. Manually deploy the repository workspace layout with its lockfile and built output. Build from a clean checkout of the tested commit in an approved Linux build environment, with development build dependencies available; this can be an operator-run build and does not require CI/CD. Explicitly exclude `.env*` secrets, `.local`, backups, Git metadata and personal deployment state from artifacts. Native dependencies such as Sharp must be installed for Linux; do not zip this Windows machine's `node_modules` into the deployment. Use startup command `npm start`, `SERVE_WEB=true`, `HOST=0.0.0.0`, `NODE_ENV=production`, and platform `PORT`. Do not run database migrations/seeds at application startup.
4. Set `AZURE_SQL_SERVER` to the portal-verified server FQDN, `AZURE_SQL_DATABASE=SS-SkillMgmtApp-SQL-Dev`, `AZURE_SQL_RUNTIME_AUTH=managed-identity`, and optional `AZURE_SQL_MANAGED_IDENTITY_CLIENT_ID` only for a selected user-assigned identity. Enable the app identity and its approved network access; never open all IPs as a shortcut.
5. As the separate setup identity, inspect the target database before choosing fresh provisioning versus full data migration. Install only missing reviewed migrations. Create/rebind the restricted `skill_management_runtime` database user to the actual App Service identity and grant only the explicit reviewed procedure permissions. Register its account in `AccessRuntimeAccount`; `ACCESS_ACCOUNT_ID` must belong to this target database. Azure resource RBAC does not replace database grants.
6. Set organization `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID`, `ENTRA_WEB_CLIENT_ID` and `PUBLIC_APP_ORIGIN`. Provision real approved identity/account mappings separately. Keep `DEV_DIRECT_LOGIN=false` and `HOSTED_DEMO_LOGIN=false` unless an explicitly approved isolated synthetic demo deployment is intended.
7. Verify liveness, real authentication, restricted SQL reads/writes and wrong-tenant/inactive/unauthorized denials. `/api/health` is liveness only. Add files, Azure AI and Redis only after each backend is implemented/configured and its dependencies verified.

## Manual promotion workflow

1. Develop and test on the existing isolated testing setup with synthetic or explicitly approved sanitized data. Never copy real organization employee records, files, tokens or credentials back into personal hosting.
2. Pin the tested commit/tag. Run the release checks and prepare an organization-specific build/configuration from that commit. Vite Entra IDs/redirects are build-time configuration, so the test environment's frontend bundle is not automatically a valid organization artifact.
3. Validate the actual target adapters too: a test against Blob-backed attachments does not establish SQL-binary storage acceptance, and a Gemini reply does not establish Azure AI parity. Exercise SQL-binary upload/review/snapshot/preview and Azure-specific integrations with isolated test data before release.
4. Record the artifact hash, commit, intended target/schema version and manual release checklist. Take the organization's approved pre-release backup; review compatibility with the previous app version and execute only reviewed target migrations, using a separate setup identity.
5. Upload/release manually through the approved App Service deployment channel, with a maintenance window if there is no tested slot-based path. Never upload personal `.env` files or replace the organization's runtime identity with developer credentials.
6. Run target smoke/E2E checks after deployment. Keep the previous artifact/configuration for rollback; code rollback is safe only when compatible with the resulting schema. A database restore can lose post-backup writes and is an explicitly coordinated recovery operation.
7. Keep the existing testing deployment/database available for the next change. Promote code versions; do not overwrite organization data with the test database on subsequent releases.

## First hosting-only manual ZIP

`npm run package:azure` prepares a content-addressed source ZIP under ignored `artifacts/`, with a SHA-256 manifest. Its explicit allowlist includes workspace manifests/lockfile, API/web sources, web public assets and build configuration. It rejects source symlinks and excludes local environment files, built output, dependencies, backups, logs and personal deployment state. The manifest records the source commit and whether the working tree was dirty; an artifact containing the current uncommitted hosting changes is not described as an unchanged committed release.

The ZIP contains `package.json` at its root, with the `apps/api` and `apps/web` workspace layout retained. It is **source for an Azure Linux remote build**, not a prebuilt run-from-package artifact. Add these App Service settings alongside the already configured `NODE_ENV=production`, `SERVE_WEB=true` and `HOST=0.0.0.0`:

| Setting                          | Value  | Reason                                                                          |
| -------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `true` | Install dependencies and build both workspaces on Azure Linux                   |
| `NPM_CONFIG_INCLUDE`             | `dev`  | Keep TypeScript/Vite build dependencies available even with production NODE_ENV |

Remote build uses root `npm run build`, and runtime uses the previously configured `npm start`. Leave platform `PORT` automatic. Do not enable `WEBSITE_RUN_FROM_PACKAGE` for this remote-build path or enable Basic Auth as a workaround. Confirm organization policy permits dependency downloads from the build host; an isolated SCM endpoint needs the operator's approved VPN/network path. Later Entra Vite settings must be present **before rebuilding**, not only before restarting.

For the user's preferred **portal-only manual upload**, the current Linux experience is App Service → Deployment Center → Manual Deployment (Push) → Publish files (new) → Browse files/drag ZIP. Review the ZIP root (`package.json` and `apps/`), keep server-side build enabled (do not skip build for this source ZIP), then deploy and inspect build/runtime logs. If this option is unavailable in the current portal, Development Tools → Advanced Tools → Go opens the authenticated Kudu site; the new Deployments experience supports ZIP upload/build there. Availability and private-network reachability still need verification against the actual app. The older Kudu Tools → Zip Push Deploy page described in historical guides is not the same experience. Sources: [App Service team's portal upload announcement, July 2026](https://azure.github.io/AppService/2026/07/30/quick-deploy-portal.html), [new Linux deployment experience, April 2026](https://azure.github.io/AppService/2026/04/06/quickdeploy.html).

After organization CLI login/PIM activation and explicit tenant/subscription/resource-group verification, deploy the reviewed ZIP manually. The following placeholders must be filled from the actual target; the supplied screenshot does not establish the tenant/subscription/resource group:

```powershell
az login --tenant '<ORG-TENANT-ID>'
az account set --subscription '<ORG-SUBSCRIPTION-ID>'
az account show --query '{subscription:id,tenant:tenantId,name:name}' -o json
az webapp deploy --resource-group '<ORG-RESOURCE-GROUP>' --name 'SSSkillmgmtAppWebAppDev' --src-path '<ABSOLUTE-PATH-TO-REVIEWED-ZIP>' --type zip
```

Use a current organization-approved Azure CLI with Entra deployment support. Do not run `az webapp up` or create replacement resources for an already-provisioned app. Follow deployment logs, then verify the portal-provided hostname at `/api/health`, `/` and a direct SPA link such as `/my-skills`. Correct API authentication errors must remain JSON, not the SPA HTML page. This first gate verifies hosting only: no database identity, employee SSO, SQL binary storage, Redis or AI connection is implied. Never reuse personal `.env` credentials to make the first page appear functional.

Sources: [App Service Node build automation](https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs#customize-build-automation), [ZIP deployment](https://learn.microsoft.com/en-us/azure/app-service/deploy-zip), [Entra deployment without Basic Auth](https://learn.microsoft.com/en-us/azure/app-service/configure-basic-auth-disable#deploy-without-basic-authentication).

### Local package verification

Prepared `skills-appservice-f68f128925aa.zip` (922,734 bytes, 325 source files), SHA-256 `f68f128925aa1f20a8d6052a640bd783d7ef6ba69b8dcec24d3ce3d64228201a`. The manifest identifies base commit `d2d7d5d5ee8fcd9bd727f3af462d3b0cc37036c5` and uncommitted working-tree changes. Do not describe it as an already committed or deployed release.

Seven architecture/packaging checks, four hosting/authentication regression checks and API typechecking passed. A separately extracted copy built both workspaces using existing local Windows dependencies and passed HTTP smoke checks for health, actual built assets, deep links, anonymous API denial and missing assets. This rehearsal caught and fixed a SPA fallback failure when the deployed directory has a hidden ancestor; it does not establish Linux native-dependency installation, actual Azure remote-build/network success, browser SSO or database readiness. The next gate is the manual organization deployment and its build/log/HTTP verification. The earlier failed-rehearsal package is not the release candidate.

## SQL binary attachment design and rollout status

The implementation described below is now prepared locally in migration 085 and the provider-neutral file adapter. Eleven rollback-only SQL scenarios passed on the existing development test database, including skill/certificate round trips, draft staging, immutable snapshots, current-manager enforcement, scoped Analytics DENY, foreign files, corrupt uploads and denied direct table reads. No 085 schema change or fixture data persisted in that test database. The organization still requires manual migration/deployment and hosted acceptance. See [private file storage](PRIVATE_FILE_STORAGE_2026-10-17.md).

Use a dedicated file-content table keyed by account and immutable file/version ID, with `VARBINARY(MAX)` content, length and SHA-256 digest, linked metadata for filename/MIME type and creation provenance. Preserve current certificate 5 MB and ordinary skill evidence 10 MB limits and image validation/compression. Do not store base64 in ordinary JSON records or include binary columns in list/Analytics/export queries.

All of these paths must be adapted together before this backend is enabled:

- Owner certificate/evidence upload, replacement, removal and authenticated preview/download.
- Durable multipart staging and explicit AI-autofill file intake; process-local temporary buffers do not support multiple app instances or reliable restart recovery.
- Combined draft certificate staging, finalization, immutable submission snapshot reads and exact assigned/current-manager review reads.
- Authorized Analytics file viewing and before/after resource/access rechecks. A file ID alone must never grant byte access.
- Transactional content/metadata association, immutable version retention, length/hash checks and retry reconciliation when a response is lost after commit.
- Inventory/backup/restore documentation and dry-run retention reporting. Do not delete replaced/historical content while policy remains dry-run only.

Existing owner/manager/Analytics policy and SQL procedure checks remain canonical. Add reviewed migrations and procedure-specific grants; do not give runtime blanket table read/write permissions. SQL binary storage does not provide malware scanning or establish issuer authenticity.

Provision SQL capacity for file payloads, retained versions, transaction logs and backups, not just structured records. Illustrative sizing only: 500 employees × 5 files × 2 MB averages approximately 5 GB of raw payload before history, metadata and backup overhead. Measure the real workload and rehearse upload/download concurrency and restore performance before selecting final capacity. Redis continues to cache approved small projections; certificate bytes stay outside the cache.

Organization application of the SQL binary migration/adapter and hosted acceptance are **pending**. Existing Blob references cannot be made readable in a fresh SQL database without copying/validating the original bytes and retaining their relationships. No automatic fallback to personal storage or external AI is authorized for organization data.
