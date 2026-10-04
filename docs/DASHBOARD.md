# Action-oriented main dashboard

The main workspace is `/workspace`. The server constructs its manifest from the authenticated actor, current effective permissions, implemented store contracts and actual own/assigned records. Role names do not select dashboard variants. The administration overview remains a separate console.

## API and authorization

`GET /api/dashboard` lists authorized cards, priorities, own/assigned scope descriptors and implemented quick actions. Each card loads independently from `/api/dashboard/{attention|learning|capability|requests}`. Actor/scope selectors are rejected. Only the requests card accepts a single supported `status` filter; other cards and manifest accept no query selectors. Responses use `Cache-Control: no-store`.

Card authorization is repeated before retrieval. Restricted SQL procedures resolve record ownership/assignment and permission authority; afterward the route rereads workspace revision and effective dashboard policy. A changed revision/policy discards the response. The client clears denied data and reloads discovery. Focus, relevant notification/claim events, manual refresh and a visible-tab 60-second interval refresh discovery and card data. This is periodic refresh, not realtime push.

No team, department or organization dashboard cards are advertised. Those require actual allowed resource ID resolution and domain queries before implementation; an existing permission code alone is insufficient.

## Metrics and actions

| Card | Data source and meaning | Action |
| --- | --- | --- |
| Needs attention | Assigned pending skill reviews, permitted submitted/in-progress requests/incidents, own overdue learning that the actor can manage | Open the specific review, request or learning task |
| Today's learning | Tasks in active own plans; completed / total tasks defines the displayed percentage. Due/overdue uses each plan's timezone | Open task session or learning plans |
| My capability | Full SQL claim summary, distinct APPROVED, SUBMITTED and DRAFT states; changes-requested/rejected remain separate | Open a status-filtered skill list |
| My requests | Participant-authorized own request summary, submitted/in-progress/resolved and recent records | Filter queue or open record |

Attention jobs isolate ordinary source failures and report partial results, rather than presenting missing queues as zero. Authorization failures fail closed. Every card has loading, empty and retry/error states. Quick actions open existing authorized composers; none submit automatically. Learning completion does not verify skill proficiency, and no overall capability percentage is calculated.

Contextual AI buttons open the existing assistant with a short editable prompt. They do not send a message, call the model or persist business changes automatically. Existing assistant retrieval tools enforce current effective permissions and participant scopes. Broader AI recommendations still require authorized data retrieval and human review of drafts.

Migration 026 supplies the actor-authorized full-dataset skill summary; module composition injects existing public Skills, Learning and Workflows contracts. Dashboard owns no domain mutations or duplicate persistence.

## Validation

Dashboard API tests cover renamed roles, unimplemented stores, permission expiry/revocation, full-dataset totals, forged actor/scope selectors, timezone urgency, partial source failure and authority changes during retrieval. Production browser acceptance uses the owner's Chrome with clearly labelled synthetic demo fixtures. Temporary QA records are cancelled after acceptance; business records are not changed.

## Attention workspace refinement (2026-10-04)

Attention now returns permission-selected groups for pending skill reviews, own overdue learning, and assigned request/incident submitted or in-progress work. Each group has a full scoped count and an exact implemented queue destination. A failed ordinary source has a null count with retry, never a fabricated zero. Authorization failures still fail closed; HTTP rechecks effective policy and workspace revision before returning results. No role names determine visibility.

Queue tiles navigate explicitly: request inbox, kind and status are restored from the URL; overdue learning opens the Backlog tab. Individual preview links open the specific record/claim/task. Preview items are bounded to three per source and six overall, ordered by known urgency within that sample. They are recent previews, not a claim to globally rank every record. Queue links expose the complete list. High priority, overdue, awaiting review, triage and in-progress labels remain distinct; no invented SLA or assessment count.

The attention UI uses responsive queue tiles, empty/loading/error states and existing contextual AI help. Zero-work state suppresses the tile grid. Automated verification: 143 checks (5 architecture, 115 API, 23 web), strict typecheck and architecture checks passed; production Vercel build passed. Tests cover full scoped counts versus bounded previews, exact links, permission omission and partial/unknown rendering.

Production acceptance uses the owner's Chrome: manager and employee zero states; exact submitted INCIDENT inbox/type/status filters; direct learning backlog; synthetic QA request REQ-100 assigned from Khushi to Hemant showing Requests to start = 1 and the exact matching queue. At 390px viewport the document width was 375px and all six tiles fit their widths without horizontal overflow. Desktop viewport restored. No Git push. Deployment FRStwFgdMbq1j7qqKQfy42H8hL4o. QA record is cancelled after testing; its audit and notifications remain.

## Today's learning refinement (2026-10-04)

The card focuses on one pending task from active own plans. Selection prioritizes overdue, then today, then upcoming work using each plan's timezone; equal urgency sorts by date and stable plan/task IDs. Paused/archived plans and completed tasks are excluded. The task displays its planned date, timezone and estimated minutes; no scheduled hour or SLA is invented. Selected-plan completion and overall active-plan completion are labelled separately. Logged minutes sum actual minutes from completed active-plan tasks, excluding unfinished session drafts.

Continue opens the exact plan/task learning session. Read-only users get a viewing label. Today and overdue counters open their corresponding learning tabs. Empty states provide the implemented create-plan action only when authorized; they do not fabricate a percentage. AI help opens an editable, bounded task-ID prompt without automatically sending or changing learning data. The `my_learning_task` read tool retrieves only the current actor's exact task, rejects actor/scope overrides, checks current permissions before and after retrieval, and excludes private session notes. Learning completion still does not verify proficiency.

Validation: 148 automated checks (5 architecture, 117 API, 26 web), strict typecheck and architecture checks passed. Vercel production build passed; deployment `47pDfZm2a3A9k1UrpisWfn9nexfF` is live. Owner's Chrome acceptance verified the exact saved Azure task session, Today queue with four tasks, empty overdue backlog, and live AI objective/exercise with the `Your selected learning task` source. Selected-plan 0% and overall 13% matched existing QA records; 20 actual minutes were displayed. At 390px viewport document/client widths both measured 375px; task and stat containers had no horizontal overflow. Desktop viewport restored. Anonymous learning-card API returned 401. No learning completion/reschedule, skill changes or Git push; the test AI conversation remains in the normal recent-chat history.

## My capability refinement (2026-10-04)

Capability uses the full own-summary contract for every status count and a bounded three-claim preview from the latest own-claims page. The SQL own read orders by update date then claim ID. Reviewed, pending and self-assessed counts open distinct implemented filters; nonzero changes-requested and rejected counts offer their own feedback lists. No capability score, denominator or proficiency gain is inferred. Preview fields exclude description, projects, evidence and feedback; the authorized detail dialog exposes those through the existing skill workflow.

An exact `/my-skills?claim=<UUID>` link is resolved only against the freshly loaded own profile. Missing or foreign claims produce an unavailable message; links never submit or edit automatically. Add-skill actions require both current store editing authority and effective skill claim/catalogue permissions. Empty/read-only states preserve viewing without unsupported mutation controls.

The existing `my_skills` AI tool now distinguishes all claim states and provides full summary counts where supported, alongside its bounded first-page preview and `hasMore`. Current actor ownership, no selectable person, normal permission rechecks and the explicit review-before-write flow remain in force. The profile-help button opens an editable prompt; it does not send automatically.

Automated checks: 151 passed (5 architecture, 118 API, 28 web); strict typecheck, module-boundary checks and Vercel production build passed. Deployment `89HtGQLN7W4UjdfGGWwmQNuGD4FN`. Owner's Chrome verified the existing Java draft exact detail dialog and the approved-status link showing only the manager-reviewed QA claim. Anonymous capability endpoint returned 401. Existing demo business records were not mutated; no Git push.

Live profile AI guidance retrieved `My skill claims` and correctly distinguished the existing one reviewed claim, one Java draft and zero pending claims. The normal demo session expired during the final theme check and was renewed through the existing demo login. At 390px viewport the settled document/client width was 375px; capability containers and recent rows had no horizontal overflow. Dark mobile visible-card capture was inspected; desktop/light theme restored. Full-page mobile capture timed out, so the visual artifact uses a viewport capture. The test conversation is retained by the normal recent-chat policy; no business write was confirmed.

## My requests refinement (2026-10-04)

The own requests card offers All, Submitted, In progress, Resolved and Cancelled status buttons with full scoped counts. It shows a bounded latest-three preview with reference, request/incident type, recipient, actual update date, current status and high priority when present. Date labels use UTC. There is no invented waiting-response state, SLA or overdue count.

Selecting a status loads `/api/dashboard/requests?status=<supported status>` independently. This endpoint filters the complete own queue through the existing workflow contract and returns full summary totals separately from `previewTotal`. Actor/inbox/scope overrides, repeated statuses and filters on other cards are rejected. Existing post-read policy/revision checks also guard filtered previews. Preview records exclude body text and participant identifiers. UI loading, empty and retry states replace stale previews; aborted or mismatched-status results are ignored. Current status is owned by the dashboard card so periodic/manual refresh retains the selected view. Request-update events now trigger dashboard discovery refresh alongside notifications.

Exact title links open the existing participant-authorized request detail; View matching requests opens the full corresponding status filter. Raise request is shown only with effective own creation/view authority and opens the existing composer, which rechecks its options. No dashboard action submits, reassigns or resolves automatically. Existing request AI help remains an editable prompt and uses the actor-bound workflow tools.

Validation: 156 automated checks (5 architecture, 120 API, 31 web) passed. Strict typecheck and architecture checks passed. After the refresh-persistence fix, request-component checks and typecheck passed again; final production build passed. Deployment `BMZrHvdZu979it7TPYPsGXMPaDF1`. Owner's Chrome confirmed four own records, latest-three All preview, the complete single Resolved preview, Submitted empty state after rapid status switching, Resolved retained after manual refresh, the correct full-list filter and exact REQ-81 detail/activity. At a 390px viewport the document/client width was 375px; tabs, preview container and all three rows had no horizontal overflow. Anonymous filtered endpoint returned 401. No workflow business mutations or Git push.

Live AI guidance retrieved `Your requests and incidents`, listed the actual four own records with three cancelled and one resolved, and suggested viewing detail or preparing a confirmable new draft. No change was executed. The test conversation follows normal recent-chat retention. Mobile viewport capture was inspected and desktop viewport restored.

## Quick actions and contextual assistance (2026-10-04)

The authorized manifest adds a short description and optional assistance to each implemented quick action. Effective own grants and available stores determine the actions; profile access and a configured model additionally gate AI controls. Incident-only creation gets incident assistance, with no request authority implied. No extra storage reads are needed to discover these shortcuts.

Manual links open the existing add-skill, learning-plan or request composer. AI learning opens the intake using `/learning?action=planner`, resolved only after freshly loaded learning management authority. Other AI controls prepare a bounded editable prompt; suggestions in the assistant now also prefill instead of sending automatically. Current-page navigation assistance is refreshed when the open assistant's route changes. Existing server-bound tools and composer permission rechecks remain authoritative; explicit review/save/submit is required.

A different shortcut cannot overwrite unsent text. The assistant offers Keep my message or Replace message; closing retains the unsent text. Invalid, empty or oversized context intents are ignored. Choosing a prompt never invokes the model by itself.

Validation: 160 automated checks passed (5 architecture, 122 API, 33 web), strict typecheck and module boundaries passed, and production build passed. Deployment `9HUAaZPt9Pv1qUYrHwJDM6JAxRn7`. Owner's Chrome verified all three manual composer entries, actual AI planner intake, editable skill/request prompts, both unsent-text choices, and live interactive request assistance. AI produced a structured Not submitted QA preview; Review request draft opened the composer in place and the generated subject/description transferred into editable fields. The composer was cancelled; no business record was submitted or changed. The test chat follows normal recent-chat retention. A demo session expired following deployment and was renewed with the existing login flow.

At 390px viewport, document scroll/client widths were both 375px and each quick-action card scroll/client widths were both 296px. Mobile cards and assistant viewport captures were inspected. Desktop viewport and light theme were restored. No Git push.

Final dark-theme visual inspection prompted brighter quick-action link/icon colours. The CSS-only refinement was deployed as `FHnVxjbtz9L9DyaxeSdVnrdW27Ww`; its production build passed. Desktop full-page capture timed out, so viewport captures were used.
