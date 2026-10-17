# SQL first-read delay: verified cause

Verified on 17 October 2026 with read-only Azure activity-log queries, the existing local database benchmark and a fresh-process comparison. No application runtime, SQL data, permissions, infrastructure, auto-pause or billing settings were changed.

## Finding

**A login-triggered Azure SQL serverless auto-resume caused most of the 53.3-second first read.** This is now supported by an explicit Azure `ResumeDatabase` event, rather than inferred only from connection duration or the auto-pause setting.

The database is the existing `skill-management-dev` instance in Southeast Asia, not the separate organization-hosting proposal. Observed settings: `GP_S_Gen5`, General Purpose serverless, maximum 2 vCores, minimum 0.5, auto-pause delay 60 minutes, free offer enabled and free-limit exhaustion behavior `BillOverUsage`.

## Correlated evidence

All local times below are IST on 17 October. UTC timestamps are included for reproducing Azure log queries.

| Evidence                                    | Observation                                                          |
| ------------------------------------------- | -------------------------------------------------------------------- |
| Benchmark started                           | 14:10:47.084 IST / `2026-10-17T08:40:47.084Z`                        |
| Azure resume event                          | `Microsoft.Sql/servers/databases/resume`, `EventName=ResumeDatabase` |
| Resume trigger                              | `properties.Caller=Login`                                            |
| Provider's original start timestamp         | 14:10:49 IST / `2026-10-17T08:40:49Z` (second precision)             |
| Provider's original success timestamp       | 14:11:31 IST / `2026-10-17T08:41:31Z` (second precision)             |
| Azure's explicitly reported resume duration | **42.6917076 seconds**                                               |
| Matching Started/Succeeded correlation ID   | `276248B8-828D-47FD-8F2E-69E2389D44F5`                               |
| First connection phase                      | 46.237 seconds, with two driver retries                              |
| First database operation phase              | 7.075 seconds                                                        |
| Total first read                            | 53.319 seconds                                                       |
| Subsequent warm workspace reads             | 182, 222 and 206 ms                                                  |

The resume duration alone is about 80% of the total first-read time and overlaps the initial connection phase. Azure's success description explicitly reports `Elapsed time to auto-resume ... is 00:00:42.6917076`.

The activity-log envelope timestamps differ from the provider's original timestamps: Started has `eventTimestamp=2026-10-17T08:40:55.694852Z`, and Succeeded has `eventTimestamp=2026-10-17T08:41:55.708866Z`. Use the provider's original timestamps and stated elapsed duration for this correlation. Earlier activity-log reads exposed only a separate database-write pair; the later query also returned these explicit resume events. The separate write pair alone was insufficient evidence.

## Control: new process while SQL is online

A new Node process used the same restricted runtime connection path and the same read-only workspace procedure, followed immediately by a second read. It closed its connection pool afterward.

| Measurement                                      | Fresh process, online database | Same process, warm pool |
| ------------------------------------------------ | -----------------------------: | ----------------------: |
| Started, IST                                     |                   14:19:26.997 |            14:19:33.614 |
| Total                                            |                    6,616.64 ms |               198.47 ms |
| Initial pool connection                          |                    4,779.11 ms |                 0 calls |
| Operation, including physical driver checkout    |                    1,830.50 ms |               198.41 ms |
| Token acquisition, nested within the other spans |          1,788.29 ms / 2 calls |                 0 calls |
| Driver retries                                   |                              0 |                       0 |

Both returned the same 17-person workspace with no legacy templates. This demonstrates that a new app process has additional connection/authentication cost even while SQL is already online, but the approximately 43-second resume and the retries were absent. This is a single local comparison, not a hosted p95 result or a controlled estimate of every millisecond saved by avoiding resume.

## Driver behavior and attribution limits

The installed `mssql` implementation's `ConnectionPool._connect` creates an initial probe connection, destroys it, then prepares its physical connection pool. The first procedure call creates/checks out another physical connection. Consequently, the recorded `operation` phase includes driver connection work and is **not SQL-engine execution time alone**. See `node_modules/mssql/lib/base/connection-pool.js` and `node_modules/mssql/lib/tedious/connection-pool.js` in this checkout.

The installed Tedious driver's transient connection retry path runs after transient SQL login errors. Its default retry interval is 500 ms; two retry delays therefore do not explain a 46-second connection wait by themselves. The original benchmark counted retries but did not retain SQL error numbers. Error 40613 is the documented auto-resume behavior, but it was not directly captured for this historical request and must not be presented as an observed error code.

Token acquisition measured 1.357 seconds across two calls in the original benchmark. It overlaps connection/operation spans and must not be added to them. There are no TCP/TLS/SQL-engine traces for the original request, so the remaining connection and operation time cannot be attributed exactly between network setup, authentication, driver checkout and database work from the available evidence.

## Implication

Frontend bundle reductions and warm query improvements cannot eliminate the paused database's resume interval. Avoiding that interval requires an approved database availability strategy; the current free-offer and billing configuration must be checked before changing auto-pause or compute settings. Retaining auto-pause means first-use latency must be accepted and handled clearly while preserving connection retry behavior. No keep-alive loop, automatic prewarming or infrastructure change was introduced by this investigation.

Microsoft documents [login-triggered auto-resume, approximately minute-long resume latency and error 40613](https://learn.microsoft.com/en-us/azure/azure-sql/database/serverless-tier-auto-pause-resume?view=azuresql), and explains [auto-resume trigger and duration telemetry](https://techcommunity.microsoft.com/blog/azuresqlblog/identify-causes-of-auto-resuming-serverless-workloads-in-azure-sql-database/4452741).

## Reproduction

Run `npm run bench:access -w apps/api` only when a read-only database measurement is intended. To inspect the historical resume, query Azure Monitor activity logs for this database between `2026-10-17T08:20:00Z` and `2026-10-17T08:50:00Z`, retaining operation, status, correlation ID and provider properties. The decisive fields are `EventName`, `Caller`, `originalEventTimestamp` and the elapsed duration in the success description. Do not force a pause or keep SQL active merely to reproduce the condition.
