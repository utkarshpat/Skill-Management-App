import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

export type DatabasePhase = 'token' | 'connect' | 'acquire' | 'operation';
type Timing = {
  databaseCalls: number;
  databaseMs: number;
  databaseConnectionRetries: number;
  databasePhases: Record<DatabasePhase, { calls: number; ms: number }>;
};
const context = new AsyncLocalStorage<Timing>();
export function startRequestTiming() {
  const started = performance.now();
  const timing: Timing = {
    databaseCalls: 0,
    databaseMs: 0,
    databaseConnectionRetries: 0,
    databasePhases: {
      token: { calls: 0, ms: 0 },
      connect: { calls: 0, ms: 0 },
      acquire: { calls: 0, ms: 0 },
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
      // Token is nested inside connect, which is nested inside acquire. Do not add
      // these together. Operation includes driver-pool checkout and adapter work.
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
