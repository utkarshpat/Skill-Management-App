# Repository instructions

For work involving authorization, people/access administration, reporting hierarchy, sidebar visibility, dashboard capabilities or AI tools, read and follow [the approved Access Management baseline](docs/ACCESS_MODEL_REDESIGN.md).

- Person, role, permission, scope, relationship and workflow constraints are distinct. Do not infer authority from role names or hierarchy alone.
- Current direct-manager skill review is an explicit relationship policy. Preserve current-manager, assigned-reviewer, active-status, reviewable-state and no-self-review checks.
- Backend effective access is the canonical contract, including explanations. Keep discovery/UI projections consistent with execution-time API and SQL checks.
- Offer only implemented actions and genuinely enforced scopes. Resolve scopes on the server; matching scoped DENY overrides ALLOW. Caller-supplied purpose or scope IDs cannot expand authority.
- Access changes follow Preview → Recheck → Transaction → Audit. Identify unsupported historical grants for review without silently deleting them.
- Clearly distinguish approved target design from implemented behavior. Do not claim new scope support based solely on types, permission codes or visible controls.
