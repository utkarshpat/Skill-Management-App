# Linked capabilities — implementation and release record

The approved workflow supports skills without certificates and many-to-many links between an employee's skill claims and certification records. New or editable certifications require at least one owned, published-catalogue skill before submission. Historical submitted/approved credentials retain their existing review history.

## Employee workflow

The common Add capabilities dialog starts with certificate / no certificate, then one details page and review. Certificate cards use collapsible sections, upload/preview on the left and all credential details on the right. Related skills are canonical catalogue chips; they are not free-text tags. Each new skill still requires its own proficiency and experience. Existing reviewed records can be reused without another approval or duplicate upload.

Incomplete private drafts store bounded form data independently of real claims, including authenticated private staged files. Completing a draft materializes valid records and transfers its file metadata transactionally without copying Blob bytes. Save/recovery uses a stable submission ID plus expected group and item revisions. File uploads remain separate operations: a failed upload preserves a draft and must not appear as successful submission.

New certificates accept the existing validated PDF, JPEG/PNG/WebP, DOCX and UTF-8 text formats up to 5 MB. Images normalize/compress to WebP. Certificate files are mandatory for new submission, while incomplete drafts may be missing a file. Previously reviewed certificates reuse their saved file. Supporting skill image uploads remain available after saving a real skill draft.

## Review and authorization

One combined request is assigned to the exact current direct manager. Each new skill and credential has its own decision and feedback; all decisions commit together. Grouped items cannot be submitted/reviewed independently through legacy endpoints. Current account/person activity, explicit DENY, required permissions, current reporting chain, assigned reviewer, submitted state and no-self-review remain mandatory. Manager changes require the owner to explicitly reroute the complete request.

Submission snapshots preserve credential/skill details, relationship mapping, attachment metadata and decisions. Later corrections do not rewrite a previous review. Draft links are private; submitted links are published. Linking already approved records produces LINKED status, not a new manager approval.

Business Analytics retains migration 070's exact submitted-file scope; relationship counts operate over existing individual records and do not multiply skill/certificate totals. A linked or approved certificate never automatically proves proficiency or current validity.

## AI assistance

Explicit AI autofill sends the selected file to the configured provider. Gemini supports image/PDF parts; DOCX/text use bounded extracted text. Other providers return a manual-entry fallback for unsupported binary extraction. Suggestions are bounded to current published skill and active credential/provider catalogue candidates, rechecked before delivery and confirmed by the user. No automatic proficiency, employee identity, approval, expiry assumption or catalogue amendment is generated. AI read tools return compact own/assigned group progress without uploaded file contents.

## Release checks

Migration 071 includes schema, authorization, transactional workflow, private file staging, notifications and own/manager/Business read projections. Migration 065's scheduler remains deferred for organization hosting. Verification results and deployment state will be recorded after final checks; implementation presence is not deployment confirmation.
