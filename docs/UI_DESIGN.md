# UI design

The interface prioritizes the laptop workflow and adapts to phones. Sopra Steria's supplied wordmark is preserved. White surfaces, a light grey canvas, charcoal text and restrained brand-red actions use a shared stylesheet, `apps/web/src/ui.css`. Native system fonts avoid third-party font loading. Controls use consistent spacing, neutral borders, readable labels and visible focus states.

## Current pages

- **Dashboard:** People, Roles and active Departments summaries, three direct management actions, and five recent changes.
- **People:** searchable roster, selected-person highlight, account fields and role assignments. Individual permission overrides remain available in a collapsed advanced section.
- **Roles & permissions:** searchable roles, a focused permission editor and collapsed preset suggestions. Permissions use readable labels; Allow/Block, scope and optional expiry remain explicit. Adding a permission requires an explicit scope and rejects an existing permission/scope pair. Role names remain independent of authority.
- **Organization:** visual organization/reporting trees with connected cards, zoom/fit controls and selected-record editors. Selecting a person exposes Edit roles and opens that person's editor. Department branches can open a filtered assignment table. Direct department membership and optional teams remain supported.
- **Role assignments:** people-by-role checkbox matrix with name search and department filter. Changes remain drafts until Save assignments. Each person is saved sequentially with the expected shared revision and an audit event. A failed row stops the batch and reports partial completion; the entire batch is not atomic. Assign a replacement administrator before removing the existing last administrator.
- **AI assistant:** floating launcher on authenticated screens, keyboard-accessible conversation panel and truthful connection status. The composer remains disabled until the server has a configured model. See AI_INTEGRATION.md for limits and supported tools.
- **Activity log:** searchable Time/Action/Actor/Target table with readable action labels and a no-results state. Technical revision numbers remain in the database/audit model but are not a display column.
- **Sign-in:** a single centered Microsoft sign-in card. The temporary development login remains clearly separate and development-gated. Marketing copy and preview links are removed.
- **My profile:** actual identity and workspace details. The placeholder capability-journey panel and outdated statement about missing reporting relationships are removed.
- **Preview URL:** a simple, explicitly planned module list replaces the old roadmap, connection-status widget and decorative capability diagram. It exposes no employee records and is no longer promoted on sign-in.

The selected administration view is represented by the validated `view` query parameter and survives a page refresh. Sidebar navigation and native form controls remain keyboard accessible. Individual edit values are not serialized into the URL.

## Page navigation and contextual actions

The top navigation contains the current page title once. The large repeated title, subtitle, development-workspace label and session badge were removed. Dashboard creation shortcuts, New person and New role now appear in the navigation for their relevant pages. Organization view switches and Add delivery unit use the same navigation region; Activity log exposes its search there. Existing permission checks still determine whether people-management actions are shown.

Save person, Save role and branch/reporting saves remain inside their editors. Save assignments stays alongside the assignment table and filters. Save is contextual to the displayed record or draft, rather than a generic navbar action. The top bar sticks during desktop scrolling and wraps actions below the page title on phones; the sidebar remains the section navigator.

## Responsive behavior

At laptop sizes, a compact persistent sidebar and paired list/editor panes keep related tasks together. Below the layout breakpoints, panes stack and navigation becomes a labelled horizontal strip. Roster/tree regions and audit tables contain their own scrolling. Page headers constrain long titles so the page itself does not overflow. The desktop account footer and mobile sign-out control do not duplicate each other. Reduced-motion preferences disable nonessential transitions.

## Validation and scope

Strict type checking and production builds pass. Browser checks cover the real Microsoft owner's dashboard, People name search and selected record, collapsed individual permissions, role editor, audit filtering, organization tree, and unsigned sign-in. People, roles, organization and audit were checked at a 390px phone breakpoint; page scroll width matched the available document width after the long-header fix. The viewport was restored after verification. No SQL access grants, people, role memberships or reporting relationships were changed by this UI increment.

These are the implemented administration/account screens. Skill submissions, review queues and employee operational dashboards remain future workflows. They must use actual records and current permission scopes. The local page-design prompt pack was removed at the user's request.

Current browser checks verified the real owner's three cards (17 people, 9 roles, 2 departments), Anupriya's visual-node role edit, the role checkbox table, 14 NHS SBS members in the department filter, and the disconnected assistant state. No role assignments were saved during these UI checks. Normal page areas use the arrow cursor; inputs retain their text caret. Chrome's separate caret-browsing setting requires manual F7 if enabled.

Review reference: [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md).
