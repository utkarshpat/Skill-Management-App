# Engineering standards

Every increment should be runnable, reviewable and documented. Production readiness is assessed against the deployed environment and completed workflows; a successful local build is not a production certification.

## Implementation rules

Use strict TypeScript, pinned dependencies and the lockfile. Keep identity verification, business policy and persistence explicit. Validate inputs at trust boundaries; derive actor, organization, permissions and reviewer from server-side sources. Reject missing identity, inactive membership and unknown authorization paths. Use parameterized SQL and restrict runtime database permissions per implemented workflow.

Use transactions for changes and their audit events, record versions for concurrent edits, and idempotency for retryable mutations. Scope every API, search, export, job and AI tool. Keep development bootstrap data separate from production onboarding. Do not seed real employee information or infer administrator roles from successful sign-in.

Keep secrets out of Git and frontend bundles. Production uses HTTPS, approved origins, managed identity/secret management, private evidence storage and reviewed network access. Return generic failures with request IDs; operational logging must be structured and redact tokens, credentials and personal data.

## Verification and documentation

Each behavior-changing increment runs type checking, relevant tests and builds. Cover actual trust boundaries and failure modes, including denied access and leakage, rather than tests that merely repeat implementation. Browser-check real user journeys at laptop and phone sizes. CI installs with npm ci and runs type checking, tests and builds.

Update setup instructions, configuration examples, migrations, architecture decisions and known limitations alongside code. Track external resources, credential expiry and company migration requirements. Never report an integration as verified until it has actually been exercised.

## Deployment requirements still open

The current app is a personal development deployment. Before company production: finish and verify each scoped workflow; provide access administration and onboarding; replace broad development SQL networking; establish managed identity, secret rotation, readiness, monitoring, rate controls, backups/restore verification, evidence scanning/retention and deployment rollback. Resolve HR policy and grant-authority decisions with the company. AI adds the gates in AI_INTEGRATION.md.
