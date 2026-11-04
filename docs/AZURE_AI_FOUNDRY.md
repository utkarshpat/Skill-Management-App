# Azure AI integration

Updated 5 November 2026. Azure Responses/managed-identity integration was implemented locally and the user subsequently reported hosted AI and associated workflows working. Independent exhaustive model/tool acceptance is not claimed. See [current operations](CURRENT_OPERATIONS.md) for current company SSO/KT settings.

The app retains its server-owned assistant and tools. Azure hosts the deployed `gpt-6-luna` model; no Foundry Agent, web-search connection, direct SQL tool, or new application access grant is required. Existing exact manager review rules, actor-bound discovery, DENY checks, tool argument validation and before/after access rechecks remain authoritative.

## Server configuration

Use these settings in the ignored `apps/api/.env` or the API host's configuration:

```dotenv
AI_PROVIDER=azure
AI_MODEL=gpt-6-luna
AI_ENDPOINT=https://skill-mgmt-app-resource.services.ai.azure.com/openai/v1
AI_AZURE_AUTH=managed-identity
AI_AZURE_REASONING_EFFORT=low
# Company directory; managed identity itself belongs to the API host's tenant.
AI_AZURE_TENANT_ID=8b87af7d-8647-4dc7-8df4-5f69a2011bb5
```

`AI_MODEL` is the deployment name, not a project ID. The adapter accepts only approved Azure resource hosts and the model API root, then calls `/openai/v1/responses`. Project endpoints under `/api/projects/...` are rejected. No provider is selected implicitly. Unsupported configured providers fail at startup instead of silently falling back to another service.

For optional local testing only, set `AI_AZURE_AUTH=entra`. This mode uses `DefaultAzureCredential` and the token scope `https://ai.azure.com/.default`. Sign into the company directory with `az login --tenant <company-tenant-id>` if needed. Your existing personal Azure CLI/SQL identity is not proof of company Foundry access. The Azure SDK may use another configured credential earlier in its chain; ensure the selected identity is the intended company identity. The selected rollout path is direct hosted acceptance; local CLI login is not a prerequisite.

After signing in, run `npm run ai:check -w apps/api` from the repository root. This sends only a synthetic connectivity prompt through the real adapter and prints a sanitized status and token usage; it reads no employee data and makes no SQL calls.

For hosted Azure runtime use `AI_AZURE_AUTH=managed-identity`. Enable the API host's managed identity and ask the resource administrator to grant model invocation permissions on the intended Foundry resource. Set `AI_AZURE_MANAGED_IDENTITY_CLIENT_ID` only for a user-assigned identity; leave it blank for system-assigned identity. This mode does not fall back to developer CLI credentials. Do not reuse the SQL identity implicitly or assume your personal Playground permission grants the app access.

`AI_AZURE_AUTH=api-key` remains an explicit alternative where approved and requires server-only `AI_API_KEY`. Entra mode never falls back to an API key when token acquisition fails. Never place model keys or tokens in `VITE_*`, browser code, screenshots or chat. Previously stored provider keys are removed from local app configuration; externally deployed settings and external key revocation must be handled in their own accounts.

## Portal-only App Service rollout

The previously documented development app is `SSSkillmgmtAppWebAppDev`. Confirm the actual app/subscription before changing settings. Its identity may already be enabled for SQL: preserve that identity and its existing grants; never toggle it off/recreate it as part of AI setup.

1. App Service → Settings → Identity → System assigned: inspect Status and Object (principal) ID. If enabled, use that identity. If the app uses an approved user-assigned identity instead, identify it before configuring `AI_AZURE_MANAGED_IDENTITY_CLIENT_ID`.
2. On the Foundry **resource** `skill-mgmt-app-resource`, open Access control (IAM). An authorized resource administrator assigns model invocation access to the App Service managed identity at this resource scope. The current Foundry role is **Foundry User** (previously **Azure AI User**); custom least-privilege inference roles may be used where company policy provides them. Assign to the app identity, not to the employee's user object. Subscription Contributor does not itself allow granting roles.
3. Deploy the reviewed source ZIP using the existing manual upload/remote-build process. This deployment includes the new Responses/managed-identity adapter; changing settings on the older runtime alone does not implement it. Keep Linux remote build and the existing SQL/SSO/storage settings.
4. App Service → Settings → Environment variables: merge the six AI settings above into the existing configuration. Remove the retired external provider key entries and any obsolete AI API key when using managed identity. Leave `AI_AZURE_MANAGED_IDENTITY_CLIENT_ID` absent for system-assigned identity. This is a merge, not replacement of all application settings. Saving settings restarts the app, so coordinate with the manual deployment.
5. From App Service's authenticated SSH console, run `cd /home/site/wwwroot` followed by `npm run ai:check -w apps/api`. The running app identity supplies the token; no developer CLI login is needed. If the deployment layout differs, use its actual application root. Then exercise authenticated UI tool calls, structured learning output and explicit synthetic file autofill. `/api/health` alone does not test AI.

Do not add an anonymous AI diagnostic endpoint, grant the model direct database access, or alter employee authorization for connectivity testing. Private networking and approved deployment geography are independent resource settings and remain subject to company configuration.

## API behavior and feature parity

- Responses API with `store:false`, encrypted reasoning state retained only inside the current server-owned tool loop, and no upstream stored-response ID dependency.
- `low` reasoning by default; permitted configured effort values are `none`, `low`, `medium`, `high`. Each workload's existing output budget is sent as `max_output_tokens`, including reasoning. An incomplete result is rejected, never executed or shown as complete; tune budgets using measured usage and task success.
- Existing function definitions become Responses function tools with explicit `strict:false`, preserving optional argument semantics. Current server validators and permissions still decide whether a call may run. Built-in web search and other remote tools are not enabled.
- Ordered reasoning/function items and exact `call_id`/function outputs are replayed within the bounded agent loop. Opaque provider state is not returned to the browser or persisted in chat history.
- Token usage includes cached-input and reasoning counters when supplied. `output_tokens` already includes reasoning, so usage totals do not add it again. Billed usage is recorded even if a completed HTTP request returned truncated output.
- User-selected certificate PDF/image autofill uses inline Responses file/image input; DOCX/text retain bounded extracted text. Existing explicit-action, file validation/size limits, catalogue matching and access rechecks remain required. Extraction remains a suggestion for review, not issuer verification or proficiency approval.
- Upstream credentials/diagnostics are concealed. Quota returns 429; unavailable or rejected Azure identity returns 503; malformed/incomplete upstream output returns 502; cancellation/timeout returns 504. No automatic provider fallback or request replay occurs.

## Acceptance before rollout

1. Verify approved geography, deployment type, quota, identity and network path. The user-selected Global Standard deployment does not itself establish restricted processing geography or private networking. `store:false` does not mean all service logging/abuse-monitoring retention is disabled.
2. Send a synthetic plain-text request through the application adapter using the company identity.
3. Exercise a read-only tool round, complete structured plan/quiz, token usage and denied/revoked access. Verify no opaque reasoning state appears in API output or saved conversations.
4. Exercise synthetic PDF and image autofill; confirm unknown fields remain blank, catalogue IDs remain canonical and proficiency is not invented.
5. Test the API host's managed identity separately, then verify employee/manager/admin workflows after deployment. Local tests and Playground success do not establish hosted application acceptance.

Protocol reference: [Responses migration and tool formats](https://developers.openai.com/api/docs/guides/migrate-to-responses). Identity scope and resource endpoint follow the JavaScript sample copied from this deployment's Foundry portal.
