# People access popup: fixes and acceptance

The person access popup replaces inline person inspection while preserving backend effective access and Preview → Recheck → Transaction → Audit. This release changes presentation and discovery only; it grants no real user access and requires no migration.

## Corrected behavior

- Exception actions and scopes come from implemented server metadata. Displayed selection and preview payload use the same normalized value; unavailable and responsibility-only actions are excluded.
- Templates containing unsupported action/scope rules cannot be newly assigned from this popup. Existing historical assignments remain visible, with effective-access explanations and explicit removal available.
- A selected expiry date means the end of that date in the administrator's local timezone. Saved summaries show local date and time. Existing stored expiries are unchanged.
- Template counts describe configured rules, not effective grants; suspended accounts and people without additional templates are directed to their canonical effective-access view.
- Failed or cancelled previews retain inputs. Confirmation errors appear inside the person popup, with a reload action for stale revisions. New previews bind the refreshed revision and existing server receipt workflow.
- Long names and form controls fit narrow screens; card removal actions wrap below the title rather than squeezing it.

## Verification

The development-only `apps/web/access-preview.html` fixture mounts the actual AccessAdmin and intercepts every fetch, with no network writes. Its sequence exercises a failed preview, cancel without writes, stale confirmation without writes, configuration reload, successful fresh confirmation, and template selection preserved across cancellation. Exact preview inspection confirmed OWN for profile.view and the selected local expiry day. Switching to users.manage selects ORGANIZATION. Unsupported actions are absent. A mixed-rule template is labelled as configured rules, including DENY and expired rules; a suspended person never receives an “active employee baseline” claim.

Browser layout checks passed at 375px and 1280px, with popup scroll width equal to client width. The 98-character template selector also fits its parent without horizontal overflow. Unit coverage includes fail-closed metadata, stale selection normalization, unsupported templates, invalid dates and local expiry roundtrips in India, UTC and New York including a DST transition. Existing API policy tests cover exact input/actor/revision receipt binding, side-effect-free preview, stale rechecks and preserved historical grants.

Hosted administrator interaction through real SSO is still deferred. Local fixture acceptance is not evidence of a hosted privileged grant. Hosting migration and scheduler activation also remain deferred.
