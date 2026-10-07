export type ToastKind = 'success' | 'error' | 'info' | 'warning';
export function notify(message: string, kind: ToastKind = 'info') {
  if (typeof window !== 'undefined')
    window.dispatchEvent(
      new CustomEvent('app-toast', { detail: { message: message.slice(0, 240), kind } }),
    );
}
export async function notifyResponse(path: string, method: string, response: Response) {
  if (!response.ok) {
    const body = await response
      .clone()
      .json()
      .catch(() => undefined);
    notify(
      typeof body?.error?.message === 'string'
        ? body.error.message
        : response.status === 403
          ? 'This action is unavailable with your current access.'
          : 'Could not finish. Please try again.',
      'error',
    );
  } else if (
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) &&
    !/^\/api\/(ai|assistant|knowledge-transfer|dev-login)(\/|$)/.test(path) &&
    (!/^\/api\/(my-skills|skill-reviews\/decision|workflows|recommendations)(\/|$)/.test(path) ||
      path.endsWith('/evidence')) &&
    !/(?:\/preview|\/planner)(?:[/?]|$)/.test(path)
  )
    notify(
      path.includes('/submit')
        ? 'Submitted for review.'
        : path.includes('/decision')
          ? 'Review saved.'
          : path.includes('/evidence')
            ? 'Evidence image uploaded.'
            : 'Changes saved.',
      'success',
    );
}

/** Typed convenience API backed by the same dialog-aware event contract. */
export const toast = {
  success: (message: string, title?: string) => send('success', message, title),
  error: (message: string, title?: string) => send('error', message, title),
  info: (message: string, title?: string) => send('info', message, title),
  warning: (message: string, title?: string) => send('warning', message, title),
};
function send(kind: ToastKind, message: string, title?: string) {
  notify(title ? `${title}: ${message}` : message, kind);
}
