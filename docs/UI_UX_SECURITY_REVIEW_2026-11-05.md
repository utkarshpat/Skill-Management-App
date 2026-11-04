# UI/UX and security review, 2026-11-05

Scope: latest `main` (already up to date, head `e2e260a`), documentation baseline, web styling/flow review and a web security scan. Static review plus web typecheck and the 255 web tests; the authenticated UI could not be browsed locally because the API needs a SQL store for sign-in.

## Fixed in this change

| #   | Finding                                                                                                                                                                   | Fix                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Workspace load failure and "access not provisioned" screens were bare text inside the loading spinner, with unstyled Retry/Sign-out buttons and the IDs list unformatted. | New `workspace-state-card` with heading, message, primary **Try again**, secondary **Sign out** and a formatted tenant/object ID block. |
| 2   | Spinner kept spinning above error text, implying work in progress.                                                                                                        | Error state no longer uses `session-loading`.                                                                                           |
| 3   | Duplicate, dead `Toast.tsx` (classes `toast-*` had no CSS; never mounted). Two toast systems risked future calls going to an unstyled one.                                | Removed; `ToastHost` + `toast.ts` remain the single system.                                                                             |
| 4   | Unstyled buttons: refresh-warning Retry, catalogue certification Retry, "Use as certificate" and remove-file in pending evidence.                                         | Given `secondary-button`/`admin-text-button` classes and compact sizing.                                                                |
| 5   | `SkillReviews.tsx`: Searching or filtering in `/reviews` (`unified`) reset `data` to `undefined` while loading, causing `<details className="review-legacy-history">` to collapse mid-search; clicking a team member's review link in `TeamCapability` also left `?tab=analytics` in the URL. | Kept `<details>` open whenever `filtered` or `search` is active, and used `changeView('queue')` on team review navigation. |
| 6   | `CatalogueCertificationPicker.tsx`: `enabled` state was initialized only on mount (`useState(value.length > 0)`), staying `false` if a non-empty `value` arrived after initial render. | Added `useEffect` to sync `enabled` to `true` when `value.length > 0`. |
| 7   | `BusinessWorkflows.tsx`: Selected related skill chips in the Certification form lost their labels (`Remove selected skill x`) whenever the user searched or changed pages in `/api/business/workflow/masters`. | Cached seen skill names in `knownSkillNames` across searches and pages. |
| 8   | `BusinessWorkflows.tsx`: Approvers (`directCatalogue`) on the **Amendments** tab (`catalogueMode === false`) were forced past Step 0 (`1 · Choose change`) straight to Step 1, and `'PROVIDER'` was hidden from `directCatalogue` Step 0 despite `dbo.SaveCatalogueMaster` (`087`) supporting `PROVIDER`. | Only skip Step 0 when `catalogueMode` is `true` (Certifications tab), and allow `'PROVIDER'` in Step 0. |
| 9   | `CapabilityComposer.tsx`: Upload status message had a trailing hyphen typo (`Uploading evidence for ${name}-`). | Fixed to `Uploading evidence for ${name}…`. |

## Reported functional gaps (requires SQL migration if changed)

- **Asymmetric archived-mapping validation between Skills and Certifications (`086` vs `078`/`087`):**
  - In `database/migrations/086_catalogue_forms_shared_criteria.sql` (line 48), `dbo.SaveSkillCatalogue` permits retaining an already-mapped retired certification (`AND NOT EXISTS(SELECT 1 FROM dbo.CredentialSkillMapping ...)`).
  - In `database/migrations/087_direct_catalogue_management.sql` (line 89) and `078_credential_skill_master_mappings.sql` (line 82), saving or approving a `CERTIFICATION` checks `LEFT JOIN dbo.SkillCatalogue c ON ... AND c.status='PUBLISHED' WHERE ... c.skill_id IS NULL` **without** exempting existing `CredentialSkillMapping` rows, even though `MASTERS` (`078` line 24) loads all mapped `skill_id`s (including archived skills) into `relatedSkillIds`. If a mapped skill is later archived, editing or retiring that certification fails with `Choose unique published skills from this account.` unless the archived skill ID is manually removed first.

## Reported, not changed

- **Pre-existing design lint:** thick one-sided accent borders (`styles.css:1844`, `certifications.css:64`, `capabilities.css:1461/1464`). Cosmetic; decide whether intentional.
- **Unused structural class hooks** (about 40, e.g. `an-*-panel`, `cap-skill-select`, `learning-*`) have no CSS. They are harmless wrappers but should be styled or removed to avoid confusion.
- **Prettier:** 7 files under `apps/web/src` already fail `format:check` on `main`.
- **Flow:** the shell has no "back to dashboard" affordance on unknown paths other than a link; the manager review area has separate Queue/Team/Recommendations tabs that overlap with Team capability, which may confuse reviewers (see `UNIFIED_MANAGER_REVIEWS_2026-10-13.md`).
- **Needs a live pass:** with SQL available, walk Admin, Manager and Employee workspaces on mobile widths to confirm no classless button renders unstyled.

## Security observations

No `dangerouslySetInnerHTML`/`eval`; every `target="_blank"` link inspected uses `rel` noopener; API uses `helmet` and disables `x-powered-by`; direct login is refused outside `NODE_ENV=development`. `localStorage` holds only theme, sidebar order and notification read state (no tokens). No new vulnerabilities found in the reviewed surface; this is not a full penetration review.
