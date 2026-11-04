# Audit of functional fixes in f07f320 — 5 November 2026

Scope: immutable Git snapshot `f07f320c900227168276f87d38c1b4e668a9755a`, including the five changed paths, related master-command validation and migrations 078/086/087. The active main branch and the other agent's checkout were not merged or changed. No company SQL or user data was used. This is a change audit, not a full security review or live browser acceptance.

## Findings

### [P2] Existing related-skill names are still missing on a cold certification edit

**Classification: incomplete fix, reproduced.** References at the audited commit: `apps/web/src/business/BusinessWorkflows.tsx:143`, `:245`, `:495` and `:1408`; master read shape in `database/migrations/078_credential_skill_master_mappings.sql:24–29`.

The new `knownSkillNames` map is filled only by fetched pages of `choices.skills`. Selecting an existing certification copies its `relatedSkillIds`, but does not hydrate their names. Master results paginate/search skills separately from certification rows, and a certification exposes related IDs rather than related skill names. Therefore a valid linked skill can be absent from both the current page and the cache.

Repro executed against the actual transformed component with synthetic API responses:

1. Open Amendments with catalogue approval authority and a fresh component/cache.
2. Return a certification mapped to skill Z, while the currently loaded skill page contains only skill A.
3. Choose Update existing entry, select that certification and continue to details.
4. Its chip reads **`Remove selected skill x`** rather than the linked skill's name.

Loading skill Z once makes the name appear and the new cache correctly preserves it across later searches. Thus the pagination/search fix works for **previously seen** skills, but does not cover initial edits of existing mappings. This does not alter authorization; it makes it difficult to identify/remap/delete the correct association, especially when diagnosing retired mappings.

Recommended correction: return authorized mapping display metadata alongside the selected certification, or fetch exact selected IDs through an account/access-checked read, then seed the display cache. Keep missing/retired mapping state visible. Do not infer authority from the cache or fetch unrelated accounts. Add cold-edit, multi-page, renamed/retired mapping, mixed-case UUID and failed-detail-read regressions.

### [P2] Retaining an existing archived-skill mapping blocks certification edits/retirement

**Classification: pre-existing known issue, confirmed by source; installed SQL not executed.** References: `database/migrations/087_direct_catalogue_management.sql:86–95`, `database/migrations/078_credential_skill_master_mappings.sql:81–88`, contrasted with `database/migrations/086_catalogue_forms_shared_criteria.sql:26`.

If a certification already maps to skill S and S is later archived, the UI preserves S in `relatedSkillIds` and always submits that array when editing the certification. SaveCatalogueMaster requires every supplied skill to be PUBLISHED, even if the mapping already exists; the legacy workflow path has the same requirement. Changing the certification name or retiring it therefore fails before the update unless the user removes the old mapping. The validation also runs when the requested certification state is inactive. In contrast, the skill-side path permits retaining an already-existing association to a retired certification/provider.

`f07f320` does not change these SQL rules, so it neither introduces nor resolves this blocker. The conclusion is from the exact predicates/control flow; transaction-time behavior still needs an installed-database fixture.

Recommended follow-up: settle the preservation policy consistently on both sides. If existing retired associations may be retained, distinguish unchanged existing links from newly added links; continue rejecting foreign, nonexistent, duplicate and newly archived/unpublished targets and preserving mapping caps. Implement a **new reviewed migration**, not edits to already installed 078/086/087. Add rollback-only fixtures for rename, retire, reactivate, retain/remove/add associations, stale revision, DENY and cross-account cases. Do not silently drop historical mappings as a workaround.

## Verified changes and limitations

| Change                             | Audit result                                                                                                                                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team member review link            | Synthetic component probe confirms `tab=queue`, stale claim/submission/recommendation/type parameters removed, and filtered history open.                                                                                                |
| Search/category history expansion  | Empty-result component probe confirms typed search and category filters keep legacy history open. This is component state verification, not native DOM focus/scroll testing.                                                             |
| Selected chip name cache           | Confirmed across later searches after the skill was fetched once; cold-edit gap above remains.                                                                                                                                           |
| Amendment Step 0 / Provider choice | Direct approver with `catalogueMode=false` sees Step 0 and Provider. Existing Provider edit reaches `SAVE_MASTER` preview and passes the actual API command normalizer. Actual SQL save was not executed.                                |
| Provider authorization             | No new permission grant in this diff. API current capability checks and SaveCatalogueMaster's full current approval/DENY/revision checks remain. UI visibility does not establish mutation authority.                                    |
| Picker value arriving after mount  | Probe confirms nonempty external value enables association mode and selection remains visible. Clearing the last selection does not necessarily mean the user intended to leave association mode; no defect is inferred from that alone. |
| Evidence upload ellipsis           | Text-only correction confirmed; upload flow is unchanged by this diff.                                                                                                                                                                   |
| One-sided CSS accents              | Not modified by this commit; no functional finding assigned merely for a semantic accent border.                                                                                                                                         |

The report's description of queue data being reset on every loading transition is not literal in this snapshot: SkillReviews clears data on failure, while loading is tracked separately. The expanded `open` predicate still addresses keeping active search/filter context visible. The audited behavior, not that wording, determines the result.

## Verification performed

- **255/255 web tests passed** on the frozen f07f320 snapshot.
- **32/32 selected API tests passed** (`business.test.ts`, `skill-catalogue.test.ts`). This is not a rerun of every API test.
- Web typecheck passed.
- **Six positive synthetic probe groups passed**, plus one negative scenario that reproduces the cold-edit name defect. Probes execute transformed component functions with deterministic hooks/API responses and the actual API command normalizer; they are not real DOM/browser, SQL execution or a new code-coverage measurement.
- Stored procedure rules were reviewed statically. No hosted save, production rollback/concurrency, mobile, focus/keyboard or corporate login compatibility acceptance was performed.

Ignored evidence: `artifacts/audit-f07f320/`. Frozen reproduction workspace: `.local/audit-f07f320/`; run `node --import tsx audit.mjs` from that folder. It contains the committed snapshot plus the synthetic harness. The earlier 630-test coverage report targets `1ba6396` plus separate added tests and must not be relabeled as f07f320 coverage.

## Conclusion

Most targeted transitions are supported by the probes and existing tests, but the change should not be described as fully closing linked-skill chip naming. Two medium functional items remain: cold-edit name hydration and the previously reported archived-mapping blocker. No authorization broadening was observed in the inspected diff; that statement is not a full security clearance. No application fix, merge, push or company-database mutation was performed by this audit.
