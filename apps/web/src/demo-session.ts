export interface DemoSessionTiming {
  expiresAt: number;
  absoluteExpiresAt: number;
}
export interface DemoSessionNotice {
  warning: boolean;
  minutes: number;
  busy: boolean;
  error: string;
  absolute: boolean;
}
interface Environment {
  window: EventTarget;
  document: EventTarget & { visibilityState: string; hasFocus(): boolean };
  now(): number;
  transport: typeof fetch;
  schedule(callback: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}
// Activity, not API polling, keeps a demo session alive. Never stores a token.
export function startDemoSession(
  notice: (value: DemoSessionNotice) => void,
  expired: () => void,
  env: Environment = {
    window,
    document,
    now: Date.now,
    transport: fetch,
    schedule: (fn, ms) => setInterval(fn, ms),
    cancel: handle => clearInterval(handle as ReturnType<typeof setInterval>),
  },
  transport: typeof fetch = env.transport,
) {
  let timing: DemoSessionTiming | undefined;
  let disposed = false,
    running = false,
    lastActivity = env.now(),
    lastRenew = -Infinity,
    lastAttempt = -Infinity;
  let error = '';
  let published = '';
  const abort = new AbortController();
  const active = () =>
    env.document.visibilityState === 'visible' &&
    env.document.hasFocus() &&
    env.now() - lastActivity < 120_000;
  const publish = () => {
    const value = {
      warning: Boolean(timing && timing.expiresAt - env.now() <= 120_000),
      minutes: timing ? Math.max(0, Math.ceil((timing.expiresAt - env.now()) / 60_000)) : 0,
      busy: running,
      error,
      absolute: Boolean(timing && timing.expiresAt >= timing.absoluteExpiresAt),
    };
    const key = JSON.stringify(value);
    if (key !== published) {
      published = key;
      notice(value);
    }
  };
  const read = async (renew: boolean) => {
    if (disposed || running) return;
    running = true;
    lastAttempt = env.now();
    publish();
    try {
      const response = await transport('/api/dev-login/' + (renew ? 'renew' : 'session'), {
        method: renew ? 'POST' : 'GET',
        cache: 'no-store',
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]),
      });
      if (disposed) return;
      if (response.status === 401 || response.status === 403) {
        disposed = true;
        expired();
        return;
      }
      if (!response.ok) throw Error();
      const value = (await response.json()) as DemoSessionTiming;
      if (
        !Number.isSafeInteger(value.expiresAt) ||
        !Number.isSafeInteger(value.absoluteExpiresAt) ||
        value.expiresAt > value.absoluteExpiresAt
      )
        throw Error();
      if (disposed) return;
      timing = value;
      lastRenew = renew ? env.now() : Math.min(env.now(), value.expiresAt - 30 * 60_000);
      error = '';
    } catch {
      if (!disposed && !abort.signal.aborted)
        error = 'Could not check your session. Check your connection and retry.';
    } finally {
      running = false;
      if (!disposed) publish();
    }
  };
  const tick = () => {
    if (disposed) return;
    publish();
    if (env.now() - lastAttempt < 30_000) return;
    if (!timing || timing.expiresAt <= env.now()) {
      void read(false);
      return;
    }
    if (active() && env.now() - lastRenew >= 300_000 && timing.expiresAt < timing.absoluteExpiresAt)
      void read(true);
  };
  const activity = () => {
    if (env.document.visibilityState !== 'visible' || !env.document.hasFocus()) return;
    lastActivity = env.now();
    // Expired cookies require sign-in, never a silent new session.
    tick();
  };
  const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
  // Scroll does not bubble from inner dialogs/panels; capture their activity too.
  for (const event of events)
    env.window.addEventListener(event, activity, { passive: true, capture: true });
  env.window.addEventListener('focus', tick);
  env.document.addEventListener('visibilitychange', tick);
  const timer = env.schedule(tick, 30_000);
  void read(false);
  return {
    continueSession: () => {
      lastActivity = env.now();
      return read(true);
    },
    stop: () => {
      disposed = true;
      abort.abort();
      env.cancel(timer);
      for (const event of events)
        env.window.removeEventListener(event, activity, { capture: true });
      env.window.removeEventListener('focus', tick);
      env.document.removeEventListener('visibilitychange', tick);
    },
  };
}
