# UI/UX and security review, 2026-11-05

Scope: latest `main` (already up to date, head `e2e260a`), documentation baseline, web styling/flow review and a web security scan. Static review plus web typecheck and the 255 web tests; the authenticated UI could not be browsed locally because the API needs a SQL store for sign-in.

## Fixed in this change

| #   | Finding                                                                                                                                                                   | Fix                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Workspace load failure and "access not provisioned" screens were bare text inside the loading spinner, with unstyled Retry/Sign-out buttons and the IDs list unformatted. | New `workspace-state-card` with heading, message, primary **Try again**, secondary **Sign out** and a formatted tenant/object ID block. |
| 2   | Spinner kept spinning above error text, implying work in progress.                                                                                                        | Error state no longer uses `session-loading`.                                                                                           |
| 3   | Duplicate, dead `Toast.tsx` (classes `toast-*` had no CSS; never mounted). Two toast systems risked future calls going to an unstyled one.                                | Removed; `ToastHost` + `toast.ts` remain the single system.                                                                             |
| 4   | Unstyled buttons: refresh-warning Retry, catalogue certification Retry, "Use as certificate" and remove-file in pending evidence.                                         | Given `secondary-button`/`admin-text-button` classes and compact sizing.                                                                |

## Reported, not changed

- **Pre-existing design lint:** thick one-sided accent borders (`styles.css:1844`, `certifications.css:64`, `capabilities.css:1461/1464`). Cosmetic; decide whether intentional.
- **Unused structural class hooks** (about 40, e.g. `an-*-panel`, `cap-skill-select`, `learning-*`) have no CSS. They are harmless wrappers but should be styled or removed to avoid confusion.
- **Prettier:** 7 files under `apps/web/src` already fail `format:check` on `main`.
- **Flow:** the shell has no "back to dashboard" affordance on unknown paths other than a link; the manager review area has separate Queue/Team/Recommendations tabs that overlap with Team capability, which may confuse reviewers (see `UNIFIED_MANAGER_REVIEWS_2026-10-13.md`).
- **Needs a live pass:** with SQL available, walk Admin, Manager and Employee workspaces on mobile widths to confirm no classless button renders unstyled.

## Security observations

No `dangerouslySetInnerHTML`/`eval`; every `target="_blank"` link inspected uses `rel` noopener; API uses `helmet` and disables `x-powered-by`; direct login is refused outside `NODE_ENV=development`. `localStorage` holds only theme, sidebar order and notification read state (no tokens). No new vulnerabilities found in the reviewed surface; this is not a full penetration review.
