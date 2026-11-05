# Portfolio hierarchy audit — e37df62

Audited exact commit `e37df62bd094837f8fba952d2d3f403f4323a4c9`, against its parent, using a frozen local archive. The user subsequently requested inclusion in the current release branch. The integration retains the prerequisite organization-label/regression commits, local workflow-only AI policy and existing coverage/browser infrastructure. No migration or mapping has been installed in the company environment by this work.

## Result

No new actionable defect was reproduced in the changed hierarchy, scope evaluation or reviewed mapping paths. This is a bounded audit, not approval to deploy or a claim of exhaustive coverage.

- Structure is Delivery Unit → Portfolio/Division → Accounts/Clients → optional organizational Project. Existing client/project identifiers remain unchanged.
- India Head → DU Head → Portfolio Manager/Delivery Manager → Account Manager → Project Manager is a reporting guide. Actual manager-person edges remain explicit. Titles and organizational ancestry do not grant review authority.
- Portfolio is structural, not an implemented permission scope. Business project membership/scopes remain independent, as specified in the baseline.
- Client and DU population/coverage require complete active ancestry. Matching DU DENY overrides client ALLOW. Broken legacy paths fail closed until explicitly mapped.
- Mapping uses preview, exact revision/hash recheck, a transaction and canonical audited organization writes. No automatic default portfolio or grant rewrite was found.

## Executed evidence

| Check                                                                                           | Result                                         |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Exact-commit API unit suite                                                                     | 384 passed, including 33 hierarchy regressions |
| Exact-commit web unit suite, after installing its own lockfile dependencies                     | 362 passed                                     |
| API and web source/test typechecks                                                              | Passed                                         |
| Generated documentation check                                                                   | Passed                                         |
| SQL migrations through 088 on a newly created local SQL Express database                        | Passed                                         |
| SQL complete ancestry, DU/client population and DU coverage                                     | Passed                                         |
| SQL unsupported Portfolio scope rejection                                                       | Passed                                         |
| SQL client ALLOW with matching DU DENY                                                          | Passed                                         |
| SQL inactive Portfolio and unmapped legacy client fail-closed                                   | Passed                                         |
| Mapping template preview/apply, preserved client UUID, revision increment and two audit records | Passed                                         |
| Replaying the applied mapping with its old revision                                             | Rejected with 51009                            |

The SQL target was a newly created `SkillMgmt_PortfolioAudit_*` database on local `SQLEXPRESS`, using fictional Neha Rao/Aditi Menon and Northstar Bank/Financial Services. No company database, application connection setting or existing database was modified. Migration testing required sqlcmd's quoted-identifier option. SQL fixtures and evidence are retained privately under `.local/audit-e37df62/`; the general scope fixture rolled back, and mapping fixtures remain only in that new local audit database. This does not establish Azure managed-identity/RBAC or hosted acceptance.

## Integrated regression checks

The integrated application passes source/test typechecks, production build and generated-document verification. All 62 Chromium desktop/mobile E2E scenarios pass. The review-disclosure regression now asserts the renamed Legacy reviews section is initially open and remains open during search/filtering. Browser fixtures use the canonical `scopeValid` flag and a complete DU/portfolio/client path; Portfolio is not offered as a permission scope.

Merge resolution preserves the concise AI prompt's hierarchy wording, exact current-manager policy and separate workflow-only response guard. The prompt remains below its existing 2,500-character test limit. Package-lock resolution preserves cross-platform optional dependencies and adds the upstream happy-dom test dependencies; lockfile validation passes.

## Rollout and remaining acceptance

The commit's maintenance sequence is necessary: stop traffic, install 088, preview and apply the approved complete client mapping, verify effective scopes and direct-manager review, then release the matching application build. Installing 088 alone deliberately makes old direct-DU client paths unusable. Archived inconsistent branches can block mapping and require explicit reviewed repair; the supplied operations documentation acknowledges this.

The company DU/portfolio/client mapping and actual manager-person relationships have not been supplied or applied here. Real SSO, hosted access revocation, visual browser acceptance for this separate commit and the full opt-in installed-SQL suites remain separate checks. Existing catalogue archived-mapping/cold-name findings are outside this hierarchy commit.

The separate 90% coverage target remains incomplete. These audit passes do not replace that gate or justify publishing a release ZIP as accepted.
