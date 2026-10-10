# Business Operations: implementation and UX contract

Status: approved requirements with a local implementation increment, 10 October 2026. Migrations 059–064 are installed on `skill-management-dev` as of 10 October 2026. The Personal baseline and verified existing administrator’s explicit System Admin responsibility are activated there. Additional scoped assignments and hosted/production acceptance remain pending; rollback tests alone do not install migrations. The user approved multiple project memberships, explicitly scoped Business Operations, System Admin organization-wide Business Operations, manager-or-Business-Operations amendment eligibility, and a rich analytical dashboard with one-click filtering/export. Layout, chart choices and storage structures below are implementation proposals. No authority is assigned merely by this document or by installing table definitions.

## Membership and authorization foundation

- Keep employee identity, primary organization placement, direct manager, project memberships and access responsibilities distinct.
- Add stable project IDs and many-to-many person/project memberships with active validity, revision checks and audit. Preserve existing organization records; do not reinterpret a team as a project without an explicit mapping.
- Store each responsibility's allowed scope IDs and optional capability filters together. Resolve membership and matching DENY on the server before loading data. An organization's project list is not an access grant.
- Define project-to-organization relationships explicitly. A person's home department must not be assumed to be the department of every project they join.
- A person in Project A and Project B counts once in a combined people total. A credential appearing through both memberships counts once by record ID. Separate per-project breakdowns may overlap and must disclose this; their sum need not equal the unique total.
- Use current active membership for current-scope authorization. Historical activity is activity for currently authorized people/records unless a separately enforced historical-access policy is introduced. Former project membership must not restore access.
- Keep current direct-manager/exact-assigned-reviewer claim decisions intact. Broader analytics access grants no approval authority. File downloads require their own enforced resource policy.

## Dashboard layout proposal

| Area                | Content and interaction                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope bar           | Authorized DU/department/project selectors, capability filter when applicable, activity date range, visible filter chips, Reset and Export                          |
| Summary cards       | Unique employees, employees with current reviewed credentials, reviewed skill holders, pending submissions, expired credentials and credentials expiring in 30 days |
| Trends              | Skill/certification submissions and manager decisions over the selected activity period; explicit event timestamps                                                  |
| Coverage            | Skill/proficiency coverage heatmap and certification category/issuer distribution with stated denominators                                                          |
| Renewal             | Expiry timeline, 14/30/60/90-day filters, expired queue and employee/credential drill-down                                                                          |
| Comparisons         | DU/department/project coverage within allowed scope; overlapping project memberships disclosed                                                                      |
| People and records  | Searchable, sortable, paginated employees, claims and certifications; review and validity shown independently                                                       |
| Demand and matching | Explicit demand requirements, scoped eligible candidates and explainable matches once those modules exist                                                           |

Charts expose tooltips, readable labels, keyboard-accessible filters and a tabular alternative. Support light/dark themes and narrow screens. Use graphs only where they answer a specific question; keep operational drill-down tables accessible from the corresponding metric.

## Metric semantics

- Certified employee totals count distinct active people with an approved, currently valid credential; show no-expiry credentials explicitly. Certification-record totals remain separate from employee totals.
- Manager review and calendar validity are separate dimensions. An approved-but-expired credential appears in reviewed history and expired attention, not the current-certified total.
- Skill coverage uses reviewed claims and a defined level threshold; pending claims and learning completion are not verified capability. People without claims remain in the authorized denominator.
- Activity date range filters submission/review events. Expiry filters use validity dates. Current coverage is an as-of snapshot; label it separately instead of silently applying an activity window to current holdings.
- Counts and percentages use the entire filtered authorized result, not only the displayed page. Empty, loading, failed and partial results must not be presented as a successful zero.
- Scope/domain names and membership bindings come from canonical records, not fuzzy matching of employee titles or free-text credential categories.

## One-click interactions and export

- Clicking a summary card, chart segment, heatmap cell or expiry bucket applies an equivalent visible filter to the relevant drill-down. Keyboard activation has the same result; filters can be removed individually.
- Keep selected filters in the URL where appropriate for refresh/back/deep links. URL inputs select a subset of server-authorized data and never widen scope.
- One-click Export downloads all matching authorized rows, not just the current page. Initial formats proposed: CSV and XLSX. Display the selected dataset/filter context beside the action. Charts may offer separate image/PDF exports later.
- Export includes filter metadata, generation/as-of time and metric labels. Recheck effective access before delivery. Protect spreadsheet cells from formula injection. For large exports, use a bounded job with a progress state, expiry, cancellation and authenticated download.
- Each independent dataset declares its applicable filters. Do not make an issuer/expiry filter silently alter unrelated skill metrics, or make an activity date range masquerade as a historical coverage snapshot.

## Loading and performance

- Prioritize summary cards and essential charts, load drill-down details on demand, and preserve the final layout with skeletons. Retain existing content during same-scope refresh; hide obsolete data immediately when authorization/scope changes or becomes unresolved.
- Compute aggregation in scoped SQL queries with suitable membership/date/status indexes. Avoid full-roster downloads, per-employee loops and loading every private claim in the browser.
- Bound pagination/concurrency; coalesce overlapping identical authorized reads without sharing results between actors. Cancel superseded requests and discard late results after filter or access changes.
- Return coherent metric timestamps and surface per-panel failures. Measure endpoint count, query count and hosted latency before setting performance acceptance thresholds.

## Implementation order and acceptance

1. Define action/field visibility contracts, durable Personal baseline and scope explanations; preserve existing grant IDs and preview migration effects.
2. Build project memberships and responsibility assignments, then matching API/SQL enforcement and scope-transfer/revocation tests.
3. Deliver scoped read-only dashboard summaries, coverage, expiry and record drill-downs; then filters and complete-result exports.
4. Add certification/provider master catalogues and structured amendment approval transactions; retain ordinary employee workflows.
5. Add actual demand/matching modules with explainable criteria and scoped candidate queries before offering their controls.

Acceptance includes a person in two projects; overlapping scope totals; membership removal; multiple scope/capability assignments; explicit DENY; inactive actor/employee; foreign account or forged scope ID; changed access during reads/exports; out-of-order filter requests; approved expired credentials; failed datasets; large paginated exports; and accessibility of chart-driven filters. Catalogue approval retries must not create duplicate entries. Live migrations and authenticated hosted acceptance are separate release steps.

## Implemented increment and release boundaries

Code now implements the opt-in Personal baseline, explicit System Admin and Business Operations responsibilities, separate multi-project memberships, actor/account-bound APIs, scope explanations, and matching SQL enforcement. Migrations 060–064 are registered after pending migration 059. Existing unsupported grants are retained. The baseline starts disabled; existing authorized people/access administrators activate it and assign reviewed responsibilities through the previewed administration flow. Installing migrations alone does not automatically make legacy role holders organization-wide Business Operations users.

`/business` provides Analytics, Demand & matching, Amendments, and Projects & access according to canonical current action flags. Analytics has six scoped summary cards, reviewed proficiency heatmap (top 10 skills, all five ranks), issuer/category bars (top 15), expiry buckets, submission/decision activity, overlapping-scope comparisons (up to 30), searchable/sortable 25-row drill-downs and CSV/XLSX whole-result exports. Scope unions deduplicate people. Review and expiry are independent. Coverage/event periods are labelled. Superseded requests and exports are cancelled; obsolete filters hide prior data behind matching skeletons. A workflow tab change remounts its state, avoiding interpretation of an amendment row as a demand.

Master proposals create/update/retire skills, credential definitions and providers. Provider/credential master rows are independent from existing free-form certification records and recommendations; nothing silently rewrites legacy names. Master lookup is literal-searchable and paginated, with full published skill criteria prefilled for human editing. System Admin reviews proposals with feedback and applies the decision, definition and audit atomically. An update proposal records its target definition revision; intervening changes prevent approval from overwriting newer definitions. Exact repeated proposals, completed decisions, demand creation and shortlisting do not duplicate rows.

Demand creation requires a selected currently allowed responsibility binding and 1–20 canonical requirements. Matching uses manager-reviewed skills meeting explicit level thresholds and approved, currently valid credentials with an exact case-insensitive master-name/provider match. It does not infer availability or suitability from missing claims, fuzzy-match providers, validate issuer authenticity, or grant review/file access. All writes recheck current action prerequisites, locked access revision and current resources. Existing exact current assigned direct-manager skill/certification review policies remain separate.

Administration and catalogue lookups require their own actions. Analytics/export and matching reads require current reports/profile prerequisites. Denying analytics does not itself revoke the independent manager-or-responsibility amendment policy. Scoped bundle DENY, explicit action DENY, inactive accounts/people/scopes and expired responsibility assignments still win. Personal baseline and explicit System Admin sources are included in effective-access explanations; editable role names confer neither policy.

AI integration includes `business_insights`, `credential_expiry`, `business_people`, `business_report_options`, `business_amendment_options`, `business_demand_options`, `business_demands`, and `business_demand_matches`. They accept bounded filters and subset selectors, never another actor/account or caller-selected authority. Tool facts are compact and paginated. SQL reads, tool delivery, model rounds and final replies recheck current scope/revision; changed scopes reset conversation history. `amendment_draft` and `demand_draft` are presentation-only outputs. A short-lived actor-bound, single-use handoff opens the appropriate human form; canonical scope/requirements/provider selection, preview and explicit confirmation remain mandatory. AI cannot approve, shortlist, grant access or export/send employee data autonomously. Provider settings remain server-side; new behavior was verified using synthetic providers, without a billable live model call.

Deliberate release limits: capability/domain-restricted responsibilities, reporting-subtree grants, historical membership authorization, chart/PDF exports and asynchronous export jobs are still target work. These controls are not offered. Synchronous exports cap at 50,000 matching rows and ask users to narrow larger results; CSV/XLSX exports cover every matching row within that bound. The administration screen uses an account-wide snapshot under current administration authority; large-roster administration search/bulk flows remain future optimization. Coherent SQL reads briefly hold serializable workspace locks; long exports can delay writes and need latency/load measurement before broader rollout. Scope authorization must not be traded for a shared cross-actor cache.

Verification uses unit/API/UI tests, type checks, architecture checks, production builds and isolated synthetic SQL transactions in the development database. Rollback cases cover overlapping projects, DENY subtraction, inactive people/actors, forged scope IDs, individual action denies, baseline without roles, renewal validity, idempotent approvals/demands/shortlists and stale target revisions. The fixture asserts that its people and pending schema are absent afterwards. Browser acceptance uses loopback synthetic data; it is not hosted/SSO acceptance. Permanent migrations, reviewed baseline/responsibility activation and authenticated hosted acceptance remain release steps.

Migration 062 corrects analytics/matching reliability without changing review authority. Demand qualification requires reviewed and current definitions on standard enterprise-v2, with ranks 1–5. Legacy/custom ranks remain recorded evidence without assumed equivalence. Coverage uses stable skill IDs and current catalogue names. Activity counts immutable audited submission/decision events for current authorized owners, retaining repeated cycles and events after return to draft. Current resource filters apply; dates select event timestamps. Missing audit history is not fabricated. Permanent installation of 059–062 remains pending.

Migration 063 enforces renewal continuity: the same credential/issuer, issue date at least the source issue date, and no expiry or a current expiry extending the source. Invalid historical replacements cannot suppress reminders. Normal save conflicts are actionable. Migration 064 adds read-only recovery of exact actor-bound committed workflow commands from audited input; current action/scope/deny and matching checks remain enforced. It neither performs a new write nor authorizes one from an old preview. Permanent 059–064 installation, activation and hosted acceptance remain pending.

## Development activation — 10 October 2026

The current server-configured company workspace has the Personal baseline enabled for 17 active provisioned employees. Utkarsh Patel, matched to the signed-in Azure operator and independently verified as an existing authorized administrator, has an explicit Organization System Admin responsibility. The preview/recheck/transaction/audit flow was used for both changes. Additional Business Operations people/scopes and project memberships are assigned deliberately through administration; no role-name promotion or default project mapping was performed. Earlier pending-installation notes above are historical for this development target; hosted/production deployment remains separate.

Organization resolution is bounded to the configured account and active provisioned people. Unknown/inactive accounts and non-null Organization resource bindings fail closed. Foreign-account people are excluded, and matching scoped denies subtract members even from Organization ALLOW. SQL administration may omit empty JSON arrays; the API now returns consistent empty collections and rejects malformed collection shapes so newly activated workspaces render correctly.

See [development activation record](WORKSPACE_ACTIVATION_2026-10-10.md).
