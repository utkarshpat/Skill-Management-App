# Certification UI regression — 11 October 2026

Target: https://skill-management-app.vercel.app. Reviewed `392ee10`; corrections deployed successfully as `8370e7b`.

## Corrections

- Combobox Clear/Show options actions use click activation, remain keyboard reachable, and return focus to the input. Mouse-down only preserves input focus; it no longer performs the action.
- Certification profile polish is scoped under `.certification-profile`, so loading the certification stylesheet cannot apply these rules to personal Skills.

## Verification

- Web typecheck, production build and all 172 web tests passed.
- Production native browser: Enter opened issuer options; arrow keys and Enter selected Microsoft; Enter activated Clear selection.
- Personal Certifications has no redundant My certifications or Recommendations navigation row.
- Synthetic two-page PDF selected through the normal chooser, previewed before save, saved as a draft, and reopened with Page 1 of 2, View certificate and Download. Review-step content received focus; detail actions remained in the footer in the narrow browser viewport.
- Browser employee submission became Awaiting manager review; the submitted record offered View without Edit/Submit.
- Browser manager queue exposed the exact synthetic credential and its PDF. An empty note blocked Request changes. A supplied note returned the record; independent authenticated owner API read confirmed CHANGES_REQUESTED revision 4.
- Legitimate independent employee/manager demo API sessions exercised correction/resubmission and concurrent approval of that same synthetic record. Outcomes were HTTP 200 and HTTP 404: after the first decision the approved record was no longer readable through the manager's assigned review scope. Owner read confirmed APPROVED revision 6 with the attachment retained. Only one review decision succeeded.

Fixture: `QA-20261011 Keyboard and PDF acceptance`, provider `Synthetic QA Provider`. It is explicitly synthetic, not a real credential or issuer validation. Existing credentials were not changed. The record is retained for audit; no irreversible deletion was performed.

## Boundaries

Employee and manager browser checks were sequential. Two tabs in this browser share the HttpOnly demo cookie and cannot represent simultaneous independent people. API sessions were independent and used normal demo authentication, without reading browser cookies or bypassing authorization. The second browser tab was not used to claim independent cross-user browser concurrency.

This regression pass does not establish full responsive-device coverage, real Microsoft SSO, organization API integration, arbitrary network-fault recovery, or scheduled expiry delivery. The broader earlier evidence remains in `PRODUCTION_ACCEPTANCE_2026-10-11.md` and `AI_PRODUCTION_AUDIT_2026-10-11.md`; it is not a claim that all those flows were rerun for this UI commit.
