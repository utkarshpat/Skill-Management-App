import type { Request } from 'express';

export function localRequest(req: Request) {
  return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') && ['localhost','127.0.0.1','[::1]'].includes(req.hostname);
}
export function localMutation(req: Request) {
  if (!localRequest(req)) return false;
  try {
    const origin = new URL(req.get('Origin') ?? '');
    // Vite's proxy can replace Host with the API target; explicitly allow only our local UI origins.
    return origin.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(origin.hostname) &&
      (origin.host === req.get('host') || ['http://localhost:5173','http://127.0.0.1:5173'].includes(origin.origin));
  }
  catch { return false; }
}
