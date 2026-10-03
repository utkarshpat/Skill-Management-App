# Workspace UI

The navbar identifies the current page and holds its main actions. Page content does not repeat large introductory headings or development-session banners. Employee discovery stays in the Add Skill wizard. Unimplemented workflows remain tracked in requirements rather than a dashboard placeholder list.

People and Roles use a shared directory: search, ten-row pagination, clear empty states, and explicit Edit actions opening the existing dialogs. People search includes employee ID and assigned role names; account status filters active/suspended records. Role rows show actual permission-assignment and assigned-person counts. Navigation and API permissions continue to control access; display role names never grant permissions.

My Profile uses an identity card with the actual employee ID, sign-in method and assigned roles. The employee dashboard presents the authorized skill summary and workspace access. Administration shows actual people/role/department summaries and recent activity. Review queue totals come from the assigned-manager endpoint; its empty state explains where incoming work appears.

`workspace-pages.css` applies shared surface, border, accent, success and critical tokens after the theme styles. Directory, catalogue, review, audit and assignment tables use readable 14px body text and 12px column headings. Forms retain the existing paged dialogs, explicit save actions and short-screen/mobile behavior. Organization panels retain visual-tree editing and zoom controls.

At narrow widths, toolbars wrap, profile detail columns stack and tables scroll horizontally without widening the document. Assignment identity columns stay visible while exploring the matrix. Light/dark surfaces share the same layout. No sample figures or unsupported actions are introduced.
