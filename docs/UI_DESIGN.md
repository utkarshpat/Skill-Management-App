# UI design

The interface prioritizes the laptop workflow and adapts to phones. Sopra Steria's supplied wordmark is preserved. White surfaces, a light grey canvas, charcoal text and restrained brand-red actions use a shared stylesheet, `apps/web/src/ui.css`. Native system fonts avoid third-party font loading. Controls use consistent spacing, neutral borders, readable labels and visible focus states.

## Current pages

- **Dashboard:** People and Roles summaries, three direct management actions, and five recent changes. Promotional panels, permission-catalogue/audit-count cards and security implementation explanations have been removed.
- **People:** searchable roster, selected-person highlight, account fields and role assignments. Individual permission overrides remain available in a collapsed advanced section.
- **Roles & permissions:** searchable roles, a focused permission editor and collapsed preset suggestions. Permissions use readable labels; Allow/Block, scope and optional expiry remain explicit. Adding a permission requires an explicit scope and rejects an existing permission/scope pair. Role names remain independent of authority.
- **Organization:** searchable organization/reporting trees and selected-record editor. Repeated summary cards and explanatory footers are removed. Direct department membership and optional teams remain supported.
- **Activity log:** searchable Time/Action/Actor/Target table with readable action labels and a no-results state. Technical revision numbers remain in the database/audit model but are not a display column.
- **Sign-in:** a single centered Microsoft sign-in card. The temporary development login remains clearly separate and development-gated. Marketing copy and preview links are removed.
- **My profile:** actual identity and workspace details. The placeholder capability-journey panel and outdated statement about missing reporting relationships are removed.
- **Preview URL:** a simple, explicitly planned module list replaces the old roadmap, connection-status widget and decorative capability diagram. It exposes no employee records and is no longer promoted on sign-in.

The selected administration view is represented by the validated `view` query parameter and survives a page refresh. Sidebar navigation and native form controls remain keyboard accessible. Individual edit values are not serialized into the URL.

## Responsive behavior

At laptop sizes, a compact persistent sidebar and paired list/editor panes keep related tasks together. Below the layout breakpoints, panes stack and navigation becomes a labelled horizontal strip. Roster/tree regions and audit tables contain their own scrolling. Page headers constrain long titles so the page itself does not overflow. The desktop account footer and mobile sign-out control do not duplicate each other. Reduced-motion preferences disable nonessential transitions.

## Validation and scope

Strict type checking and production builds pass. Browser checks cover the real Microsoft owner's dashboard, People name search and selected record, collapsed individual permissions, role editor, audit filtering, organization tree, and unsigned sign-in. People, roles, organization and audit were checked at a 390px phone breakpoint; page scroll width matched the available document width after the long-header fix. The viewport was restored after verification. No SQL access grants, people, role memberships or reporting relationships were changed by this UI increment.

These are the implemented administration/account screens. Skill submissions, review queues and employee operational dashboards remain future workflows. They must use actual records and current permission scopes; proposed AI designs must not imply those features already exist. A separate local page-design prompt pack covers the current screens and identifies future concepts explicitly.

Review reference: [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md).
