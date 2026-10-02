# UI design

The interface prioritizes the laptop workflow and adapts to phones. Sopra Steria's supplied wordmark is preserved. White surfaces, a light grey canvas, charcoal text and restrained brand-red actions use a shared stylesheet, `apps/web/src/ui.css`. Native system fonts avoid third-party font loading. Controls use consistent spacing, neutral borders, readable labels and visible focus states.

## Current pages

- **Dashboard:** People, Roles and active Departments summaries, three direct management actions, and five recent changes.
- **People:** searchable roster, selected-person highlight, account fields and role assignments. The editor opens in a modal with Details, Assigned roles and Individual permissions sections.
- **Roles & permissions:** searchable roles, a focused permission editor and collapsed preset suggestions. Permissions use readable labels; Allow/Block, scope and optional expiry remain explicit. Adding a permission requires an explicit scope and rejects an existing permission/scope pair. Role names remain independent of authority.
- **Organization:** visual organization/reporting trees with connected cards, zoom/fit controls and selected-record editors. Selecting a person exposes Edit roles and opens that person's editor. Department branches can open a filtered assignment table. Direct department membership and optional teams remain supported.
- **Role assignments:** people-by-role checkbox matrix with name search and department filter. Changes remain drafts until Save assignments. Each person is saved sequentially with the expected shared revision and an audit event. A failed row stops the batch and reports partial completion; the entire batch is not atomic. Assign a replacement administrator before removing the existing last administrator.
- **AI assistant:** floating launcher on authenticated screens opens a full-height chat drawer sliding from the right (420px on laptops; full width on phones). The close button and Escape dismiss it and return focus to the launcher. The drawer retains current chat/draft state across closing, scrolls messages independently and keeps the composer at the bottom. Closed content is inert and hidden from accessibility navigation. Reduced-motion preferences remove slide animations. The composer remains disabled until the server has a configured model. See AI_INTEGRATION.md for limits and supported tools.
- **Activity log:** searchable Time/Action/Actor/Target table with readable action labels and a no-results state. Technical revision numbers remain in the database/audit model but are not a display column.
- **Sign-in:** a single centered Microsoft sign-in card. The temporary development login remains clearly separate and development-gated. Marketing copy and preview links are removed.
- **My profile:** actual identity and workspace details. The placeholder capability-journey panel and outdated statement about missing reporting relationships are removed.
- **Skill catalogue:** search/status filters, paginated skill table and contextual proficiency editor. New skill is in the page navigation; Save skill remains in the editor. Managers see draft/published/archived skills, while viewers see published definitions and read-only level criteria. Editors use separate Details and Proficiency levels sections, with one level visible at a time. See SKILL_CATALOGUE.md for rules and verification.
- **Preview URL:** a simple, explicitly planned module list replaces the old roadmap, connection-status widget and decorative capability diagram. It exposes no employee records and is no longer promoted on sign-in.

The selected administration view is represented by the validated `view` query parameter and survives a page refresh. Sidebar navigation and native form controls remain keyboard accessible. Individual edit values are not serialized into the URL.

## Page navigation and contextual actions

The top navigation contains the current page title once. The large repeated title, subtitle, development-workspace label and session badge were removed. Dashboard creation shortcuts, New person and New role now appear in the navigation for their relevant pages. Organization view switches and Add delivery unit use the same navigation region; Activity log exposes its search there. Existing permission checks still determine whether people-management actions are shown.

Save person, Save role and branch/reporting saves remain inside their editors. Edit assignments opens a paginated checkbox popup; Save assignments stays in its footer. Save is contextual to the displayed record or draft, rather than a generic navbar action. The top bar sticks during desktop scrolling and wraps actions below the page title on phones; the sidebar remains the section navigator.

## Responsive behavior

At laptop sizes, a compact persistent sidebar accompanies searchable lists and visual trees. Record editors open in separate modal dialogs. Below the layout breakpoints, panes stack and navigation becomes a labelled horizontal strip. Roster/tree regions and audit tables contain their own scrolling. Page headers constrain long titles so the page itself does not overflow. The desktop account footer and mobile sign-out control do not duplicate each other. Reduced-motion preferences disable nonessential transitions.

## Validation and scope

Strict type checking and production builds pass. Browser checks cover the real Microsoft owner's dashboard, People name search and selected record, collapsed individual permissions, role editor, audit filtering, organization tree, and unsigned sign-in. People, roles, organization and audit were checked at a 390px phone breakpoint; page scroll width matched the available document width after the long-header fix. The viewport was restored after verification. No SQL access grants, people, role memberships or reporting relationships were changed by this UI increment.

These are the implemented administration/account screens. Skill submissions, review queues and employee operational dashboards remain future workflows. They must use actual records and current permission scopes. The local page-design prompt pack was removed at the user's request.

Current browser checks verified the real owner's three cards (17 people, 9 roles, 2 departments), Anupriya's visual-node role edit, the role checkbox table, 14 NHS SBS members in the department filter, and the disconnected assistant state. No role assignments were saved during these UI checks. Normal page areas use the arrow cursor; inputs retain their text caret. Chrome's separate caret-browsing setting requires manual F7 if enabled.

Review reference: [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md).

## Form dialogs and theme (3 October 2026)

People, roles, skill catalogue, organization branches and reporting assignments use a shared native modal dialog. Laptop forms have fixed headers and Save/Cancel footers, section navigation and bounded contents without form scrolling. People role choices and the editable assignment matrix use pagination; permission and proficiency selectors show one assignment/level at a time while retaining the entire draft. Search, read-only rosters, trees and chat history may still scroll. Phone dialogs allow internal scrolling and retain the footer. Native modal behavior traps focus and makes the background inert; closing restores focus. Required-field validation switches to the relevant section before focusing the field. All proficiency levels are validated before publication. Busy saves disable editing and dismissal.

Theme offers System, Light and Dark from the administration sidebar and account-page header. System is the default and follows OS changes. The preference is stored locally as skill-ui-theme, survives refresh and synchronizes across tabs; no identity or credentials are stored by this feature. Semantic canvas/surface/text/border tokens cover forms, tables, trees and the assistant. The original wordmark uses a white plate in dark mode.

Browser verification at 1536x639 covered skill Details/Levels, person roles/overrides, role permissions, branch/reporting editors and the paginated assignment popup without overflowing form bodies. At 390x844 the permission popup scrolls internally with no document horizontal overflow and a fixed Save footer. Cross-section required-field focus and dark-theme persistence after reload were verified. Unsaved test drafts were discarded; no SQL data or permissions were changed.

Permission selection now uses categorized checkbox cards in both role and person popups. A scope selector separates own/workspace assignments, category counts and search narrow the list, and six-card pages keep laptop forms bounded. Selected cards show Allow/Block and expiry indicators, with a settings button for detailed edits. Checkbox labels are clickable, settings have accessible names and focus returns after configuration. Phone cards use a single column. Browser checks covered selection/removal, scope isolation, duplicate-scope prevention, Block/expiry retention, saved-role rendering, desktop fit and 390px phone scrolling; all test edits were discarded.

## Workforce intelligence colour system (3 October 2026)

The supplied Cognitive Intelligence Lab theme document is used as the colour reference for the implemented screens. The shared theme layer is apps/web/src/theme.css, loaded after existing component styles. Deep Navy (#172033) anchors navigation and light-mode primary actions; Scientific Teal (#167C80) identifies selections, links and checkbox controls; Intelligence Violet (#7657D9) is reserved for the assistant. Warm Scientific White (#F7F8F6), white surfaces, ink text (#18202A), slate secondary text (#687385) and subtle borders (#E5E8EC) keep the content neutral. Selected permissions use teal, while Block and actual error states use critical red. Published/success states remain green. Existing Sopra Steria artwork retains its original colours on a white plate in the navy sidebar.

Dark mode extends the palette with navy canvas/surfaces, lighter teal and violet text, and readable semantic colours. Theme tokens cover navigation, actions, inputs, cards, table headers, popups, tree selections and the AI drawer. Cards use a 12px radius and light shadow. Current page titles, navigation, functional workflows and bounded desktop forms retain their existing structure. Future modules described in the reference are not represented as completed features.

Browser verification covers light/dark dashboards, permission cards, organization tree, AI drawer and the 390px phone layout. The colour update changes no saved permissions or database records. Production build and strict type checks pass.
