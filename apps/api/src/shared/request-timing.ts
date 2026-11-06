import { AsyncLocalStorage } from 'node:async_hooks';
import { channel, tracingChannel } from 'node:diagnostics_channel';
import { performance } from 'node:perf_hooks';

export type DatabasePhase = 'token' | 'connect' | 'acquire' | 'checkout' | 'operation';
type Timing = {
  databaseCalls: number;
  databaseMs: number;
  databaseConnectionRetries: number;
  databasePhysicalConnections: number;
  databasePhases: Record<DatabasePhase, { calls: number; ms: number }>;
};
const context = new AsyncLocalStorage<Timing>();
let observingDriver = false;

function observeDriverCheckout() {
  if (observingDriver) return;
  observingDriver = true;
  const spans = new WeakMap<object, { timing: Timing; started: number }>();
  // Observe the driver's public diagnostics. Retain only timings and counts.
  tracingChannel('mssql:pool:acquire').subscribe({
    start(event) {
      const timing = context.getStore();
      if (timing) spans.set(event, { timing, started: performance.now() });
    },
    asyncStart(event) {
      const span = spans.get(event);
      if (!span) return;
      spans.delete(event);
      span.timing.databasePhases.checkout.calls++;
      span.timing.databasePhases.checkout.ms += performance.now() - span.started;
    },
  });
  channel('mssql:connection:create').subscribe(() => {
    const timing = context.getStore();
    if (timing) timing.databasePhysicalConnections++;
  });
}

export function startRequestTiming() {
  observeDriverCheckout();
  const started = performance.now();
  const timing: Timing = {
    databaseCalls: 0,
    databaseMs: 0,
    databaseConnectionRetries: 0,
    databasePhysicalConnections: 0,
    databasePhases: {
      token: { calls: 0, ms: 0 },
      connect: { calls: 0, ms: 0 },
      acquire: { calls: 0, ms: 0 },
      checkout: { calls: 0, ms: 0 },
      operation: { calls: 0, ms: 0 },
    },
  };
  return {
    run: <T>(action: () => T): T => context.run(timing, action),
    result: () => ({
      durationMs: Math.round((performance.now() - started) * 100) / 100,
      databaseCalls: timing.databaseCalls,
      // Concurrent database durations overlap; this is cumulative, not wall time.
      databaseMs: Math.round(timing.databaseMs * 100) / 100,
      databaseConnectionRetries: timing.databaseConnectionRetries,
      databasePhysicalConnections: timing.databasePhysicalConnections,
      // These spans overlap. Checkout can include new connection setup and validation.
      databasePhases: Object.fromEntries(
        Object.entries(timing.databasePhases).map(([phase, span]) => [
          phase,
          { calls: span.calls, ms: Math.round(span.ms * 100) / 100 },
        ]),
      ) as Timing['databasePhases'],
    }),
  };
}
// Capture the initiating context when the driver creates a connection, so a
// deferred retry event cannot be attributed to a different concurrent request.
export function databaseRetryListener() {
  const timing = context.getStore();
  return timing
    ? () => {
        timing.databaseConnectionRetries++;
      }
    : undefined;
}
export async function measureDatabasePhase<T>(
  phase: DatabasePhase,
  action: () => Promise<T>,
): Promise<T> {
  const span = context.getStore()?.databasePhases[phase];
  if (!span) return action();
  const started = performance.now();
  span.calls++;
  try {
    return await action();
  } finally {
    span.ms += performance.now() - started;
  }
}
export async function measureDatabase<T>(action: () => Promise<T>): Promise<T> {
  const timing = context.getStore();
  if (!timing) return action();
  const started = performance.now();
  timing.databaseCalls++;
  try {
    return await action();
  } finally {
    timing.databaseMs += performance.now() - started;
  }
}
