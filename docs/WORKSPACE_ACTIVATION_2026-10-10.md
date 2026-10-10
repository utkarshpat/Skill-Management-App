# Development workspace activation — 10 October 2026

The user explicitly requested activation of the complete Personal + Manager + Business Operations + System Admin model in the development database. This record covers `skill-management-dev` only; it does not claim production deployment or authenticated hosted browser acceptance.

| Item                                       | Verified state                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| Schema migrations                          | 001–064 installed                                                                      |
| Workspace access revision                  | 184                                                                                    |
| Personal baseline                          | Enabled; 17 active provisioned employees have own-profile access                       |
| Manager discovery                          | 4 eligible managers through current reporting policy                                   |
| System Admin                               | Explicit Organization responsibility for verified existing administrator Utkarsh Patel |
| Organization analytics                     | 17 active employees; account boundary and matching DENY enforced                       |
| Business AI tools                          | 8 available under the current authorized operator                                      |
| Additional Business Operations assignments | None invented; select people and canonical DU/department/project bindings deliberately |
| Project memberships                        | Supported; no mappings inferred from team names                                        |
| Audit                                      | Personal baseline at revision 183; System Admin responsibility at revision 184         |

The signed-in Azure operator was matched to the employee's Entra object ID and account tenant, then independently checked for existing profile, people/access, audit and catalogue authority. Both changes used fresh previews, receipt comparison/rechecks and the restricted-runtime transactional `SaveBusinessChange` procedure. Existing templates, grants and explicit denies were preserved. Role labels were not used to promote people.

Organization means the current configured company account/workspace. It covers provisioned active people across its delivery units, departments and projects, subject to applicable denies. It does not mean every Microsoft tenant or every account in the SQL database. It does not override assigned-current-manager review, attachment visibility or private-data restrictions. An Organization assignment cannot contain a resource scope ID. Unknown/inactive accounts, invalid bindings and foreign-account members fail closed.

Activation exposed omitted empty SQL JSON collections. The API now returns explicit empty administration lists while rejecting malformed list shapes, preventing new-workspace administration crashes.

Validation: runtime employee/access projections, real organization dashboard and AI tool discovery, audit persistence, and 17 restricted-runtime rollback scenarios passed against the installed development schema. Boundary scenarios cover another account, foreign people, inactive employees/accounts, invalid Organization bindings and scoped DENY subtraction. Rollback cleanup verified no retained synthetic records and no migration/version changes. Final sequential verification passed **449 tests** (architecture 6, API 276, web 167), production build, application/test typechecks, architecture boundaries, generated-document checks, formatting and whitespace checks.

Local deployment evidence is retained in ignored `apps/api/.local/workspace-activation-*.json` files. These include the pre-activation inventory, concrete previews and installed-state verification; no credentials are recorded. Further Business Operations assignments must use the preview/recheck/transaction/audit workflow.
