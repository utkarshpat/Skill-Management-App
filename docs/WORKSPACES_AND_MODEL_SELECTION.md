# Workspaces and model selection

Updated 3 October 2026. This increment delivers permission-derived personal navigation and dashboards, not all planned business workflows.

## Workspace behavior

`GET /api/workspace` resolves the authenticated human, then reads current effective permissions. Microsoft identity uses the existing verified tenant/object mapping. Development login uses its opaque loopback-only session; Microsoft-linked people, including the owner, cannot use that bypass.

The manifest returns only the caller's identity/role labels and capabilities. Query strings cannot choose another person or role. Inactive or unassigned people are denied, applicable explicit DENY and expired grants apply. Role labels never grant authority. Own skill navigation requires own profile and skill-view authority; creating drafts additionally requires own skill-claim and published catalogue access. API checks remain authoritative even when navigation is stale.

Administration contains organization, people, roles, assignments, catalogue and audit according to supported effective permissions. My Skills is removed from the administration sidebar. The account menu opens Personal workspace. Personal workspace provides dashboard, profile, own skills and catalogue when permitted; an authorized administrator can switch back. The root defaults to administration for permission administrators, otherwise personal dashboard.

The personal skill summary reads actual own draft totals. It does not fabricate verified skills, learning streaks or review queues. Unimplemented, already assigned workflows are listed only inside a collapsed Upcoming workflows disclosure. Predefined permission sets are editable; future TEAM/DEPARTMENT/DELIVERY_UNIT/CAPABILITY responsibilities still require scope bindings and workflow services. No scope is widened merely to make a dashboard appear.

The development login selector shows each active unlinked person's current assigned role labels. It does not let the caller invent a role or override permissions. The same personal shell supports all six existing presets and custom permission sets.

## Navigation and reload fix

React Router is mounted once around the application. Personal sidebar, brand, account workspace switches and assistant source links use client navigation. Administration view selection uses URL search parameters through the router, with history entries for browser Back/Forward. The personal shell and its manifest remain mounted while changing its pages; API reads update only page content. Login/logout and Microsoft redirects still intentionally navigate the browser because they change authentication.

For hosting, configure SPA fallback to index.html for frontend routes (`/workspace`, `/profile`, `/my-skills`, `/skills`, `/access`); do not rewrite `/api` or missing asset requests into HTML.

Verification: type checking, architecture boundaries, production build and all 41 tests pass (5 architecture, 36 API). The production build retains a bundle-size warning. Browser checks in an isolated in-memory fixture verified unchanged document markers across personal page links, the phone drawer, administration People/Roles and the account workspace switch. The 390px phone page had no horizontal overflow. Super Admin did not receive My Skills navigation without personal skill authority. Browser Back/Forward is supported by router history but was not independently verified in this browser check. No Azure records were changed.

## Model research

Current official documentation was checked on 3 October 2026. Prices below are USD per million tokens, standard synchronous requests, uncached input and short context. They are not Azure deployment prices. Availability and actual limits depend on the API account.

| Candidate | Input | Output | Proposed fit |
| --- | ---: | ---: | --- |
| OpenAI GPT-6.1 Sol | $2.00 | $10.00 | Initial quality baseline for interactive skill drafting and learning-plan reasoning. |
| OpenAI GPT-6 Luna | $0.10 | $0.50 | Cost-sensitive routine extraction and questions, if app-specific evaluations pass. |
| Google Gemini 3.8 Flash | $0.75 | $3.75 | Multimodal/document candidate with function calling and structured output. Listed prices run through 31 December 2026; $1.50/$7.50 begins 1 January 2027. |
| Kimi K3 | $3.00 | $15.00 | Long-context/vision/agentic candidate; evaluate only if the workload benefits sufficiently to justify cost. |

Example: 1,000 model calls, each with 3,000 input and 800 total billable output tokens, cost approximately $14 (Sol), $0.70 (Luna), $5.25 (Gemini at current promotional rates), or $21 (K3 before any additional cache-write charges). A chat turn can make several model calls. Conversation history, tool context, evidence and billable reasoning increase usage; taxes, currency conversion, storage and external tool fees are excluded.

These are recommendations from documented capabilities, not measured rankings on our app. Provisional preference: OpenAI Sol for establishing answer quality, then test Luna as the cheaper default; Gemini Flash is the alternate to benchmark with the same cases. Kimi K3 supports strict structured output and tools, but its always-on thinking and complete-message continuation need a dedicated provider adapter. Do not assume OpenAI compatibility makes all provider protocols identical.

Google's pricing page states free-tier data may be used to improve products, whereas paid-tier data is not used for that purpose. Use synthetic data for free-tier evaluation; choose approved terms/region/retention before real employee evidence. OpenAI API data is not used for training by default, but retention and endpoint storage controls still require review. Do not infer contractual or residency suitability for Kimi from its model capabilities.

Later update: the user selected Gemini and configured the ignored server key. A native Gemini adapter and live synthetic smoke checks are now delivered; see AI_INTEGRATION.md. Existing OpenAI/Azure/Ollama adapters remain in place; Kimi integration and broader comparative quality/latency evaluation remain pending. No billing settings were changed and no real employee data was used in smoke checks. Keep keys in ignored server configuration or deployment secret storage, never chat, Git or VITE variables.

## Evaluation before AI writes

Use the same small suite for every candidate: Hinglish conversation; asking for missing experience; matching a published taxonomy; proficiency criteria without fabricated claims; evidence-based summaries; structured draft proposals; ambiguous tool arguments; hostile evidence; refusals for foreign-person access; recovery planning with time limits; and learning-test generation. Measure completion quality, schema validity, latency and actual token cost. Authorization is enforced by the application regardless of model quality.

Approved writes still require durable proposals, exact human approval, fresh authorization/version checks, idempotency and atomic audit. Manager review, private evidence, learning, requests/incidents, demand and matching remain separate upcoming slices.

## Official sources

- OpenAI model catalogue: https://developers.openai.com/api/docs/models
- OpenAI pricing: https://developers.openai.com/api/docs/pricing
- OpenAI data controls: https://developers.openai.com/api/docs/guides/your-data
- Gemini model: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- Gemini pricing: https://ai.google.dev/gemini-api/docs/pricing
- Gemini tool documentation: https://ai.google.dev/gemini-api/docs/function-calling
- Kimi K3: https://platform.kimi.ai/docs/guide/kimi-k3-quickstart
- Kimi prices (table verified in the rendered official page): https://platform.kimi.ai/docs/pricing/chat
- React Router navigation: https://reactrouter.com/7.18.4/start/declarative/navigating
