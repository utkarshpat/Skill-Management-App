import type { RefreshStatus } from './activity-refresh';
let latest: RefreshStatus | undefined;
export const workspaceFreshness = () => latest;
export function publishWorkspaceFreshness(status?: RefreshStatus) {
  latest = status;
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent('workspace-freshness', { detail: status }));
}
