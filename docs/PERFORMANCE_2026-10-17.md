# Startup performance — 17 October 2026

## Pre-push performance review

Reviewed the lazy import boundaries, organization-fetch cancellation and dependencies, directory index freshness and ordering, notification event identity, learning task grouping and timezone formatter lifetime. No confirmed functional regression was found in these changes. The performance commit excludes the separate local hosting/private-file implementation; its settings and SQL migration are not prerequisites for these optimizations.

A repeat local CPU run preserved identical results: learning processing for 40 plans / 2,000 tasks measured 349.33 ms before and 2.99 ms after (4,000 versus two formatter constructions). Directory processing for 5,000 people / 500 templates / eight queries measured 592.43 ms before and 13.15 ms for index construction plus searches. These single-run synthetic measurements do not establish hosted latency. Regression coverage includes midnight/DST, inactive plans, template changes, aborted organization responses and independent notification invalidations.

Pre-push validation on the current local tree passed 333 API tests, 233 web tests, six architecture tests, both workspace typechecks/builds and formatting. The API count includes separate local hosting/storage tests whose implementation remains outside this performance commit. Authenticated hosted navigation and browser latency were not retested for this commit.

## Follow-up audit with SQL storage work

The local performance diff was reviewed against current access projections, directory matching/order/count semantics, notification invalidations and route changes. All 230 web regression tests passed. No additional confirmed functional regression was identified in this diff. A repeat synthetic benchmark produced identical result IDs/order for 5,000 people, 500 templates and eight queries: baseline 873.98 ms, index build 14.55 ms and indexed searches 11.78 ms (26.33 ms combined). This is one local Node CPU run, not browser/hosted latency. Existing lazy-loading behavior still needs hosted navigation acceptance; network chunk-load failures and actual rendering latency are not established by these unit/source-level checks.

The assistant now dynamically imports the skill and request draft editors only when their review controls are used. Each editor has a local loading boundary, so loading it does not replace the surrounding workspace. Existing review callbacks, authorization rechecks and mutation behavior are unchanged.

Two local Vite production builds compared the existing assistant imports with deferred editor imports. Summing unique JavaScript files in the static dependency closure of the entry, Workspace, Dashboard and AssistantWidget produced:

| Dashboard startup dependency graph |  Before |   After |
| ---------------------------------- | ------: | ------: |
| JavaScript bytes, uncompressed     | 553,879 | 395,941 |
| JavaScript chunks                  |      46 |      27 |

This is a 28.5% reduction in that graph. It excludes CSS, dynamically loaded descendants and Microsoft sign-in code. Opening the deferred editors still downloads their code. Shared chunk placement increased the entry file itself; the combined startup graph is the relevant comparison. These build measurements do not establish browser timing or hosted API latency.

Validation: production web build, all 226 web tests, web application/test typechecking and architecture checks passed. No deployment, migration or infrastructure settings were changed.

Earlier measurements in HANDOVER.md identify SQL connection/database resume latency and warm database round trips as additional targets. Next measure cold/warm hosted API timing with existing HTTP_TIMING_ENABLED instrumentation and examine query counts/plans before changing database capacity, indexes or authorization-sensitive caching. Existing working-tree hosting changes were retained separately.

## Additional administrator startup optimization

AccessAdmin now loads organization setup, the person-access dialog, catalogue and business-administration panels on demand. Each panel has its own loading boundary, preserving the surrounding navigation. Permission checks, preview/recheck/audit callbacks and panel props remain intact. This also defers the business-administration stylesheet until that panel is needed.

The comparison below starts from the first assistant optimization above and includes the administrator shell in the dashboard dependency graph:

| Administrator dashboard startup | Before this pass | After this pass |
| ------------------------------- | ---------------: | --------------: |
| JavaScript bytes, uncompressed  |          543,163 |         445,809 |
| JavaScript bytes, gzip per file |          170,423 |         144,627 |
| JavaScript chunks               |               38 |              33 |

This is a further 17.9% reduction in uncompressed JavaScript and 15.1% in compressed bytes for that flow. The employee dashboard graph remains approximately 396 KB. Deferred screens still download their own dependencies when opened. These figures exclude CSS, API responses and Microsoft sign-in, and do not establish hosted latency or browser rendering speed.

Reproduce current measurements from the repository root with `node scripts/measure-web-startup.mjs`. The script runs a local Vite build with a manifest, walks static imports for each flow and counts each emitted JavaScript file once. It reports uncompressed bytes, per-file gzip bytes and chunk counts. It does not contact the API or database. The script replaces the local web build output; historical comparison values above are recorded measurements.

## Notification refresh feedback correction

Notifications previously published `notifications-remote-updated` after a successful read detected a changed feed, while subscribing to that same event. The refresh coordinator queued an immediate second read of the feed that had just arrived. Notifications now ignores only the exact Event object it publishes. Other screens continue to receive that event, and independent cross-tab, mutation and open events still refresh the feed. Polling, retry backoff and authorization checks are unchanged.

A deterministic refresh regression verifies that a completed changed-feed read reaches another subscriber without queueing a redundant read, while independent invalidations during an in-flight read still queue a recheck. This removes one self-triggered notification request for each detected feed change; it is not a measured system-wide latency improvement. All 227 web tests, web typechecks, production build and architecture checks passed. No deployment or database changes were performed.

## Directory processing and unused organization reads

The People & Access directory now builds a memoized display/search index when its people or templates change. Index construction traverses actual assignments rather than scanning every template for every person. Searches reuse normalized text; template labels and membership counts use indexed lookups. Existing person order, template-name search order, account-status filtering, pagination, missing-template labels and membership-count semantics are retained. This index projects already-authorized roster data; it does not calculate permissions or replace backend access decisions.

Synthetic local benchmark: 5,000 people, 500 templates, three assignments per person and eight queries. The previous search path took 494.88 ms. Index construction took 9.09 ms and the same eight searches took 3.99 ms, for 13.08 ms combined. Exact result IDs and ordering matched. These are one-run Node CPU measurements with generated data, not browser or hosted latency. Reproduce with `node --import tsx apps/web/test/directory-search-benchmark.ts`.

The administrator shell also skips `/api/access/organization` while showing personal pages, which do not consume that projection. Entering administration fetches current organization data afresh. Leaving administration aborts an outstanding read and clears the projection; lost user-management capability also triggers cleanup. Demo-session behavior remains unchanged. The separate access-configuration request used by the admin shell still runs.

Regression coverage verifies directory search equivalence, counts, refreshed inputs, skipped personal-route requests, fresh reads on return to administration and rejection of late aborted replies. All 230 web tests, web typechecks, production build and architecture checks passed. No deployment, database migration or authority changes were performed.

## Learning calendar and timezone processing

Learning views previously constructed a new `Intl.DateTimeFormat` for each task date conversion and repeated the same current-day conversion per task. Calendar cells also scanned the entire active task list for each day, and backlog entries rescanned all overdue tasks for each plan.

The shared learning date helper now reuses at most 32 timezone formatters with least-recently-used eviction. Only formatter objects are retained, never formatted dates, plans or permission decisions. The learning task index rebuilds from current plans and one current timestamp on every render. It computes today once per relevant timezone, groups active tasks by calendar date and counts overdue tasks by plan in one pass. Completed tasks from paused/archived plans still contribute to streak history, and active completed tasks still count in calendar cells. The API dashboard separately reuses current-day strings within each individual learning summary; subsequent reads recompute them.

Synthetic local comparison for 40 plans and 2,000 tasks: the previous calendar/backlog/today/completion calculations took 410.94 ms and constructed 4,000 formatters. The indexed version took 5.59 ms and constructed two formatters. Task IDs/order, completed-day values, all 31 calendar counts and overdue counts matched exactly. These are one-run Node CPU measurements, not page-load or API response timings. Reproduce with `node --import tsx apps/web/test/learning-calendar-benchmark.ts`.

Validation passed: all 233 web tests, 19 dashboard API tests, both workspace typechecks/builds, architecture and formatting checks. Coverage includes midnight rollover, daylight-saving transitions, bounded formatter retention, invalid dates/zones, paused/archived plans, exact ordering and API permission/revision revocation. No migration, deployment or infrastructure change was performed.

## Remaining profiling targets

- **SQL cold connection/database wake:** earlier read-only measurements in HANDOVER.md showed roughly 55-second cold reads versus subsecond warm reads. This historical result has not been remeasured for the current hosting/database setup. Correlate existing request/database timing spans with database resume activity before adjusting infrastructure.
- **Complete certificate portfolio assembly:** `loadCertificationPortfolio` still reads every authorized page before exposing portfolio counts, with two pages per batch. Latency and response work grow with page count. A server-side aggregate plus genuinely paginated details would require a separate current-access/revision-consistent endpoint/SQL contract; raising browser concurrency alone does not resolve it.
- **Dashboard source fan-out:** a fully eligible attention card can query skill reviews, combined submissions, certification reviews, learning and four workflow kind/status combinations. The two-connection runtime pool bounds SQL execution. Measure actual query counts and queue waits before consolidating reads; preserve source failure reporting, assigned-review policy and final access rechecks.

These are code-level or historical profiling candidates, not newly measured hosted bottlenecks. Existing unrelated hosting/private-file changes were retained.
