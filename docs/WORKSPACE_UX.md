# Workspace usability and loading

My profile sits in a fixed footer in both personal and administration navigation. The scrolling area contains only reorderable links and their controls. Profile is excluded from drag targets, keyboard moves and saved preference placement. The centered logo and pinned footer remain outside this area; wheel events cannot scroll the document at a navigation boundary.

The profile page reads `/api/me`, checks the returned identity against the workspace actor, and displays stored identity, workspace, account status, roles and authentication method. Skill, learning and profile-correction destinations are independently permission filtered. There is no fabricated self-edit action or invented contact/manager information.

Notification migration 029 keeps existing recipient and scope checks and adds the exact claim ID to skill notification destinations. Requests already target their exact record. Destination pages independently authorize their detail reads.

AI shortcuts remain above the composer throughout a conversation. They populate an editable prompt without sending automatically. An existing unsent message requires an explicit replacement choice. Shortcuts come from current server-authorized capabilities.

The chevron collapses the assistant and preserves its conversation. Escape also collapses. X closes it and makes the next opening start a new conversation. Neither action cancels a model response. Hidden pending replies display an amber dot; completed replies display a teal dot. Late replies from an old chat cannot enter a newly opened conversation. They remain in the actor's durable recent-chat history. While the previous request completes, another send is disabled and its status is shown. A page reload/unmount still aborts the browser request; this is not a background job system.

Loading changes: the administration shell, personal workspace and assistant are separate lazy-loaded chunks; model status and authorized navigation share one request; notifications read skill and workflow sources in parallel; demo workspace/dashboard/assistant middleware reuses the signed subject with one fresh state read instead of repeating person snapshot reads. Active status and Microsoft-link exclusion remain enforced. No permission result cache is introduced. Demo login transitions into the application without reloading the document.

Validation covers pinned ordering, storage isolation, profile permission filtering and AI collapse/close/late-reply lifecycle. Typecheck, architecture checks and production build are required. Browser verification remains pending while the owner's Chrome connector reports `User unavailable`. Bundle reduction is build evidence, not a claim about measured production page latency. SQL wake-up and upstream model latency still need measurements in the owner's browser.
