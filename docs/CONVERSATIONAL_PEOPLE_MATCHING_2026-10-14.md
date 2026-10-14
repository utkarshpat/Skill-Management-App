# Conversational people matching — 14 October 2026

The user approved using the existing AI sidebar rather than navigating to a separate demand form. Analytics now offers **Find people** when canonical matching capability is present. The sidebar immediately asks what work/project needs people and names the starting scope. The question is local UI, avoiding an unnecessary model call. An unsent message requires an explicit keep/replace choice. The selected responsibility ID is carried as untrusted request context, not authority.

AI resolves canonical catalogue IDs, asks for essential missing requirements and calls the read-only `business_people_search` tool. Catalogue options explicitly identify Foundation=1, Autonomous=2, Experienced=3 and Expert=4. A real-provider probe initially misclassified Autonomous as L3; after adding the exact level mapping, the same request produced L2 and seven matching people.

Results are delivered through a server-backed query card, not a model-generated download link or invented table. The server supplies the exact match-count summary. The card rechecks current records and shows scope, as-of time, requested headcount and criteria. **View results** opens the existing modal pattern on the same page, with per-person reasons/gaps, full-match filtering and pagination. CSV/Excel re-run the same current filters with independent export authorization; exported rows are the complete result, not just the visible page. Exports retain criteria and headers even with zero matches, neutralize spreadsheet formulas and reject more than 5,000 people rather than silently truncating.

No demand or shortlist is created by a search. Existing saved-demand routes remain compatible for explicitly requested workflows. The ordinary matching result does not assess staffing availability or make a staffing decision. Missing reviewed evidence means **not established**, not inability.

## Authorization and data rules

- Migration 082 adds `dbo.BusinessPeopleSearch`; it grants no person/template authority. Runtime execution requires the existing account binding, active account/person, personal profile access, Business projection `canView` and `canMatch`. Exports additionally require current `canExport`.
- Scope IDs identify existing usable actor-bound Business responsibilities. Omitted scope uses the authorized union. Explicit invalid, foreign, null or array scope selectors are rejected. `BusinessVisiblePeople` retains current scope/DENY policy and deduplicates the population.
- Matching uses the existing `BusinessMatchRequirements` rules: approved four-level skill snapshots at or above the requested rank and currently approved credentials with exact catalogue name/provider matching. Superseded and expired certificates do not qualify.
- Results and exports recheck context revision, scopes and current capability after retrieval. No attachment contents, private drafts or notes are sent to the matching tool. Matching confers no review or approval authority.
- Chat history retains only the search query for result actions; viewing/exporting it performs a new authenticated read. The client keeps the selected starting scope across follow-ups and restores the matching context when resuming the chat.

## Verification and rollout

Migration 082 was installed and its reviewed scope-input hardening refreshed on the configured shared development database. Other databases must apply their reviewed migration normally. Application changes remain local until pushed/deployed.

- Actual restricted-runtime SQL tests passed seven rollback cases: normal/eligible-only reads; rejected foreign, null and array scopes; rejected ordinary employee; rejected foreign account.
- Local authenticated API checks passed scoped search, criteria/count reconciliation, full-match filtering, no saved-demand side effect, full CSV/XLSX output, foreign-scope denial and ordinary employee denial.
- A live Gemini + real SQL probe resolved Autonomous to L2 and returned seven Oracle HCM matches. The browser inherited the selected UK scope, asked the opening question immediately, processed a Hinglish requirement, displayed seven full matches and opened the in-place results modal. The CSV button produced `people-matching.csv` in Downloads. Partial-match filtering displayed all 14 scoped people with seven full matches and explicit not-established gaps.
- An incomplete HCM request produced conversational clarification. A final live Expert request returned three matching people with the compact Expert+ label; the match-only filter refreshed without removing its checkbox, and pagination/export stayed visible in the modal footer. Escape closed the modal while keeping the sidebar open.
- Unit regression coverage includes malformed/forged selectors, normalized duplicates and query bounds, revoked matching/export/workspace access, server-backed AI query delivery, zero-match export context/formula escaping, shortcut size and unsent-draft preservation, and suppression of false “Changes saved” read-only toasts.

Ignored acceptance artifacts are `.local/people-search-http-verified.json`, `.local/people-search-sql-final.log`, `.local/people-search-live-ai.log`, `.local/people-search-sidebar.png` and `.local/people-search-results.png`. They contain no API keys or login cookies. Hosted release acceptance and real SSO remain separate from these local/dev results.
