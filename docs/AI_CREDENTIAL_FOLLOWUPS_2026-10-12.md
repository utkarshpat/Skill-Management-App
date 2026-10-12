# Business AI credential follow-ups

A user screenshot showed a Business Operations aggregate response followed by a generic access error on a credential-identification question. The exact failed hosted tool arguments were unavailable, so the screenshot alone does not establish whether the original request used an invalid scope identifier or encountered legitimate changed access.

Two concrete tool-contract gaps were addressed:

- Business analytics tools did not explain that scopeId selects an authorized responsibility ID rather than a Delivery Unit/department/project resource UUID. Their results now include authorizedScopes (responsibility ID, kind and label), and parameter/prompt guidance says to use those IDs or omit the filter for the authenticated scope union. SQL remains authoritative and rejects unavailable or forged selections.
- Credential-name follow-ups previously relied on a tool described as an expiry queue. The explicit business_certifications tool reads bounded certification rows through the existing authenticated BusinessDashboard path. Guidance requires fresh records and appropriate status/validity filters, separates employee-name search from credential names, and respects pagination.

No permission, responsibility, SQL policy, file download access or review authority changes. Business access and membership are rechecked before and after retrieval, and revoked access still discards data. The tool returns the same submitted-record metadata already implemented for authorized analytics; it does not read notes or certificate bytes. Existing history is not proof of current data.

Regression tests verify credential rows, distinct responsibility/resource identifiers, actor binding, forged argument rejection, aggregate/record separation and revoked access. These are implementation checks; the exact original production request and provider selection after redeployment still require hosted acceptance.
