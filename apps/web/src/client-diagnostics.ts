const clientEvents = new Set(['window.error', 'unhandledrejection', 'react.error']);
const clientActions = new Set([
  'notifications.open',
  'notifications.close',
  'notifications.refresh',
  'notifications.item_open',
  'notifications.mark_read',
  'notifications.mark_unread',
  'notifications.mark_all_read',
  'notifications.filter_changed',
  'notifications.category_changed',
]);
let installed = false;

function safeErrorType(error: unknown) {
  const name =
    error && typeof error === 'object' && 'name' in error && typeof error.name === 'string'
      ? error.name
      : error instanceof Error
        ? error.constructor.name
        : 'UnknownError';
  return /^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(name) ? name : 'UnknownError';
}

export function reportClientError(kind: string, error: unknown) {
  if (!clientEvents.has(kind) || typeof window === 'undefined') return;
  send({ kind, errorType: safeErrorType(error) });
}

export function reportClientAction(action: string) {
  if (!clientActions.has(action)) return;
  send({ kind: 'user.action', action });
}

function send(payload: Record<string, string>) {
  void fetch('/api/diagnostics/client', {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
}

export function installClientDiagnostics() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', event => reportClientError('window.error', event.error));
  window.addEventListener('unhandledrejection', event =>
    reportClientError('unhandledrejection', event.reason),
  );
}
