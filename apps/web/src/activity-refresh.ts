export type RefreshStatus = {
  mode: 'live' | 'idle' | 'hidden' | 'retrying';
  checkedAt: number | null;
};
interface Environment {
  window: EventTarget;
  document: EventTarget & { visibilityState: string };
  now: () => number;
  focused?: () => boolean;
  schedule?: (callback: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}
interface Options {
  pollMs?: number;
  idleMs?: number;
  onStatus?: (status: RefreshStatus) => void;
}
// Timers run only while this tab is visible, focused and recently used.
// Projection freshness never replaces execution-time API/SQL authorization.
export function startActivityRefresh(
  load: () => Promise<unknown>,
  events: string[],
  environment: Environment = {
    window,
    document,
    now: Date.now,
    focused: () => document.hasFocus(),
  },
  options: Options = {},
) {
  const schedule = environment.schedule ?? ((callback, ms) => setTimeout(callback, ms));
  const cancel =
    environment.cancel ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const idleMs = options.idleMs ?? 120_000;
  let disposed = false,
    running = false,
    queued = false,
    lastLoad = -Infinity,
    lastActivity = environment.now();
  let focused = environment.focused?.() ?? true,
    failures = 0,
    retryAt = 0,
    checkedAt: number | null = null,
    timer: unknown,
    timerAt: number | undefined;
  let previousStatus = '';
  const visible = () => environment.document.visibilityState === 'visible';
  const active = () => visible() && focused && environment.now() - lastActivity < idleMs;
  const publish = () => {
    const mode: RefreshStatus['mode'] =
      !visible() || !focused ? 'hidden' : !active() ? 'idle' : failures ? 'retrying' : 'live';
    const key = mode + ':' + checkedAt;
    if (key !== previousStatus) {
      previousStatus = key;
      options.onStatus?.({ mode, checkedAt });
    }
  };
  const plan = () => {
    publish();
    if (disposed || !options.pollMs || !active() || running) {
      if (timer !== undefined) cancel(timer);
      timer = undefined;
      timerAt = undefined;
      return;
    }
    const due = Math.max(lastLoad + options.pollMs, retryAt),
      idleAt = lastActivity + idleMs;
    const ms = Math.max(1, Math.min(due, idleAt) - environment.now());
    const nextAt = environment.now() + ms;
    // Scroll/key events can extend the idle deadline hundreds of times a second.
    // Keep an earlier scheduled check; it will re-evaluate activity/freshness then.
    if (timer !== undefined && timerAt !== undefined && timerAt <= nextAt) return;
    if (timer !== undefined) cancel(timer);
    timerAt = nextAt;
    timer = schedule(() => {
      timer = undefined;
      timerAt = undefined;
      if (active()) refresh(queued, options.pollMs);
      else publish();
    }, ms);
  };
  const refresh = (force = false, age = 300_000) => {
    if (disposed) return;
    if (!visible()) {
      if (force) queued = true;
      plan();
      return;
    }
    if (running) {
      if (force) queued = true;
      return;
    }
    if (environment.now() < retryAt) {
      if (force) queued = true;
      plan();
      return;
    }
    if (!force && environment.now() - lastLoad < age) {
      plan();
      return;
    }
    queued = false;
    running = true;
    lastLoad = environment.now();
    plan();
    void Promise.resolve()
      .then(() => {
        if (!disposed) return load();
      })
      .then(result => {
        if (disposed) return;
        if (result === false) throw Error('refresh failed');
        failures = 0;
        retryAt = 0;
        checkedAt = environment.now();
      })
      .catch(() => {
        failures++;
        retryAt = environment.now() + Math.min(900_000, 60_000 * 2 ** Math.min(failures - 1, 4));
      })
      .finally(() => {
        running = false;
        if (disposed) return;
        if (queued && environment.now() >= retryAt) refresh(true);
        else plan();
      });
  };
  const activity = () => {
    lastActivity = environment.now();
    refresh(queued, options.pollMs ?? 300_000);
  };
  const focus = () => {
    focused = environment.focused?.() ?? true;
    lastActivity = environment.now();
    refresh(queued, 60_000);
  };
  const blur = () => {
    focused = false;
    plan();
  };
  const visibility = () => {
    if (visible()) focus();
    else plan();
  };
  const changed = () => refresh(true);
  environment.window.addEventListener('focus', focus);
  environment.window.addEventListener('blur', blur);
  environment.document.addEventListener('visibilitychange', visibility);
  for (const event of ['pointerdown', 'keydown', 'scroll'])
    environment.document.addEventListener(event, activity, { passive: true });
  for (const event of events) environment.window.addEventListener(event, changed);
  refresh(true);
  return () => {
    disposed = true;
    queued = false;
    if (timer !== undefined) cancel(timer);
    environment.window.removeEventListener('focus', focus);
    environment.window.removeEventListener('blur', blur);
    environment.document.removeEventListener('visibilitychange', visibility);
    for (const event of ['pointerdown', 'keydown', 'scroll'])
      environment.document.removeEventListener(event, activity);
    for (const event of events) environment.window.removeEventListener(event, changed);
  };
}
