# UI design

## AI context optimization — 3 October 2026

The AI drawer sends only the latest message and an opaque conversation reference; it no longer resubmits large rendered replies or quiz cards as history. New AI conversation resets that reference. A 4,041-character synthetic assistant reply followed by another message succeeded in the browser with two rendered replies and no validation errors. Context is bounded on the server; this does not create durable chat history. The verification used an isolated local fixture with no Azure writes. Across the increment, 69 automated tests pass (5 architecture, 56 API, 8 web), with strict types and both builds passing. See AI_INTEGRATION.md for budgets, memory expiry, token accounting and live synthetic Gemini measurements.

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

The icon-only sun/moon button in the administration navbar and account-page header toggles Light and Dark. Before an explicit choice, the default System preference follows OS changes. The preference is stored locally as skill-ui-theme, survives refresh and synchronizes across tabs; no identity or credentials are stored by this feature. Semantic canvas/surface/text/border tokens cover forms, tables, trees and the assistant. The original wordmark uses a white plate in dark mode.

Browser verification at 1536x639 covered skill Details/Levels, person roles/overrides, role permissions, branch/reporting editors and the paginated assignment popup without overflowing form bodies. At 390x844 the permission popup scrolls internally with no document horizontal overflow and a fixed Save footer. Cross-section required-field focus and dark-theme persistence after reload were verified. Unsaved test drafts were discarded; no SQL data or permissions were changed.

Permission selection now uses categorized checkbox cards in both role and person popups. A scope selector separates own/workspace assignments, category counts and search narrow the list, and six-card pages keep laptop forms bounded. Selected cards show Allow/Block and expiry indicators, with a settings button for detailed edits. Checkbox labels are clickable, settings have accessible names and focus returns after configuration. Phone cards use a single column. Browser checks covered selection/removal, scope isolation, duplicate-scope prevention, Block/expiry retention, saved-role rendering, desktop fit and 390px phone scrolling; all test edits were discarded.

## Workforce intelligence colour system (3 October 2026)

The supplied Cognitive Intelligence Lab theme document is used as the colour reference for the implemented screens. The shared theme layer is apps/web/src/theme.css, loaded after existing component styles. Deep Navy (#172033) anchors navigation and light-mode primary actions; Scientific Teal (#167C80) identifies selections, links and checkbox controls; Intelligence Violet (#7657D9) is reserved for the assistant. Warm Scientific White (#F7F8F6), white surfaces, ink text (#18202A), slate secondary text (#687385) and subtle borders (#E5E8EC) keep the content neutral. Selected permissions use teal, while Block and actual error states use critical red. Published/success states remain green. Existing Sopra Steria artwork retains its original colours on a white plate in the navy sidebar.

Dark mode extends the palette with navy canvas/surfaces, lighter teal and violet text, and readable semantic colours. Theme tokens cover navigation, actions, inputs, cards, table headers, popups, tree selections and the AI drawer. Cards use a 12px radius and light shadow. Current page titles, navigation, functional workflows and bounded desktop forms retain their existing structure. Future modules described in the reference are not represented as completed features.

Browser verification covers light/dark dashboards, permission cards, organization tree, AI drawer and the 390px phone layout. The colour update changes no saved permissions or database records. Production build and strict type checks pass.

## Mobile navigation and isolated sidebar scrolling (3 October 2026)

On phones, a hamburger in the contextual navbar opens a native modal navigation drawer from the left. Navigation retains the navy palette, logo, current-page indication and account/sign-out area. Selecting a page closes the drawer; Close, Escape and the shaded area dismiss it. Native modal focus trapping and background body scroll locking keep navigation separate from page content. Dismissal restores focus to the hamburger. Drawer entry/exit takes 180ms and respects reduced motion; resizing to desktop dismisses the drawer.

Theme selection is in the navbar's top-right corner on desktop and phone. The compact phone control has an accessible action label and tooltip. Desktop sidebar scrolling uses a viewport-height overflow region and overscroll containment. A non-passive wheel boundary handler prevents scrolling the document when the sidebar reaches either end, including when all sidebar content already fits; Ctrl-wheel remains available for browser zoom. Phone navigation can scroll independently on short screens.

Browser checks verified 390px hamburger opening, body scroll lock, selecting People, close-button dismissal, restored trigger focus, phone width and navbar theme placement. Desktop overflow/overscroll styles and wheel boundary handling were reviewed. No people or role data changed.

The theme control now uses a 44px neutral square with only the current-mode sun or moon icon, matching the supplied reference. Clicking switches to the opposite mode and persists the choice. There is no theme dropdown or visible text; accessible action labels, tooltips and keyboard focus remain. The same button is visible on desktop and phones. Production build/type checking and browser toggle checks pass.

## Login introduction and navbar account controls (3 October 2026)

Above 900px, the Microsoft sign-in card is accompanied by a laptop-only introduction: Cognitive Intelligence Lab, the tagline Understand capability. Build what comes next., and three compact capability/development/people labels. At smaller sizes the introduction is hidden and the original concise Skill Management sign-in remains. Authentication and the development-login gates are unchanged.

The administration sidebar now contains the supplied logo and navigation only. The Skill Management/Administration workspace block and duplicate account footer were removed. The navbar's left side greets the currently mapped person by display name and retains a compact current-page title. Its right side groups the sun/moon toggle, notification bell and initials avatar. The avatar opens an account popover with the current name, authentication label and the existing sign-out flow; failures remain visible and retryable. Native popovers close on outside click or Escape.

The notification bell opens a clear empty-state panel. There is no live notification service, unread badge, synthesized activity notification or new notification permission in this increment. A future authenticated feed must provide actual per-person notifications. The sidebar intentionally uses the same Deep Navy in both modes, following the supplied visual direction; the content canvas, surfaces and interaction colours adapt to the selected theme.

Browser verification covered the laptop introduction, compact 390px phone login, owner greeting, simplified sidebar, account name and Sign out button, mutually exclusive notification/account popovers, and phone navbar/popover bounds. The live sign-out redirect was not triggered during this UI check. Build and strict type checking pass; no database records or access assignments changed.

## Wider navigation and first-name greeting (3 October 2026)

Desktop navigation is 256px wide, up from 224px; smaller laptop layouts use 240px instead of 208px. The phone hamburger drawer retains its existing viewport bounds. The navbar displays “Hello,” followed by only the person's first name in a cursive Segoe Script font, with Bradley Hand/Apple Chancery/system cursive fallbacks and a theme-aware navy–teal gradient. The full display name remains available in the name tooltip and account menu. Long names truncate without pushing the account controls outside the viewport; both “Hello,” and the first name share the same cursive font, weight and size: 24px on laptops and 20px on phones.

Visual checks used an isolated in-memory development workspace, leaving Azure records and the user's main app session untouched. Laptop width, light/dark colours and 390px phone overflow were checked; frontend strict types and the production build passed.

## My Skills draft workflow (3 October 2026)

My skills now belongs to the personal workspace sidebar, filtered by effective own-profile and skill-view permissions; it is removed from administration. Add skill is a page action available only when current permissions allow claiming published skills. The table presents claimed proficiency, experience and an explicit unverified draft badge. A three-step popup separates selection, complete level criteria and the experience narrative; fields retain their draft values across steps. Save/edit, close/focus restoration, desktop form bounds and 390px phone scrolling were checked in an isolated in-memory workspace. Both desktop form pages checked had matching body/client heights, so no nested desktop scroll was required. The phone table scrolls inside its own container without overflowing the document. See MY_SKILLS.md for persistence and authorization.

## Personal workspace and client navigation (3 October 2026)

The authenticated personal shell provides Dashboard, My profile, My skills and Skill catalogue according to effective permissions. It retains the existing navbar greeting, account controls, mobile drawer and theme. The dashboard uses actual own draft totals and assigned role labels; unimplemented assigned workflows remain inside a collapsed disclosure. Administrator context is available only with access-administration authority. See WORKSPACES_AND_MODEL_SELECTION.md for scope and model research.

React Router handles sidebar links, workspace switches and assistant source links without replacing the browser document. Administration sections use router search parameters rather than direct history mutation. Login/logout retain authentication redirects. Browser checks in an in-memory fixture verified that desktop Dashboard/My skills/My profile transitions and a 390px phone drawer selection retained the same server-generated document marker; the phone drawer closed and the page had no horizontal overflow. These checks do not exercise Azure writes or Microsoft consent.

## Notifications and AI output cards (3 October 2026)

The bell now reads a scoped personal feed, with unread count, refresh/retry, mark-all-read and device-local read status. The assistant renders editable draft cards and ten-question learning-practice cards with radio choices, pagination, score and explanations. Skill draft text can be edited and passed directly to the My Skills review popup; there is no automatic save. Copy remains optional. Learning tasks are suggestions and practice attempts are transient, with clear labels rather than claimed calendar/history updates.

Browser checks covered unread/read persistence after refresh, ten selected answers and score/explanations, AI failure with retained input, a 390px layout without horizontal overflow, edited draft handoff into the Experience field, and cancellation without saving. Synthetic in-memory fixtures were used; no Azure records were changed. Live Gemini smoke checks separately verified answers, own-profile tool continuation, skill draft output and ten learning-practice questions using synthetic data. Automated verification passes 47 tests (5 architecture, 42 API); types and production builds pass, with the existing bundle-size warning retained.

AI messages now render actual Markdown rather than displaying literal asterisks. Shared typography covers headings, lists, bold/italics, tables, quotes and code. A read-only document canvas expands structured drafts into a native modal with a paper-style surface, fixed copy/download/close actions and contained document scrolling. Draft preview/edit preserves the text used for the form handoff. Document scrolling is separate from the bounded record-editing forms. HTML and remote images are disabled, and model-authored links are restricted to frontend workspace routes.

Formatting verification: the full suite passes 49 tests (5 architecture, 42 API, 2 frontend rendering/security), and strict application/test types and production builds pass. Markdown is a separate 155KB lazy-loaded chunk; the pre-existing main-bundle warning remains. Browser checks verified semantic emphasis/lists/table output, laptop canvas layout, copy contents, Escape preserving the drawer and 390px canvas bounds without document overflow. The embedded-browser download check stalled, so file-export completion was not confirmed; the temporary fixture was closed and viewport restored. No model calls, Azure writes or access changes were needed for this formatting increment.

## Stable navigation across assistant links — 3 October 2026

Users with effective administration access keep the administration shell on personal profile, My Skills, published catalogue and personal workspace URLs. AI links and sidebar links resolve to the same pages. Independent own-profile/skill capabilities control the personal capability links; administrative access alone does not grant personal skill access. Ordinary employees retain their personal workspace navigation.

The shell stays mounted across these routes, Dashboard returns to the administration overview, and the AI drawer/draft survives client-side navigation. Page actions belong to the current content, including Add skill on My Skills. Workspace identity/capabilities are fetched once when establishing the authenticated shell and reused for initial page rendering; record APIs remain authoritative for current permissions. Chrome verification covered Dashboard → My Skills, stable administrative navigation, active personal selection and retained unsent AI text. Regression checks cover the routing boundary and independent personal grants. Typecheck, production build and all 78 checks pass (5 architecture, 63 API, 10 web).
