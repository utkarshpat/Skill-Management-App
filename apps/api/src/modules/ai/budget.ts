import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { withRuntimeDatabase } from '../../shared/database.js';
import { AccessError } from '../../shared/errors.js';
import { currentRequestId } from '../../shared/request-timing.js';
import { errorType, logEvent } from '../../shared/logger.js';
import type { Provider } from './assistant.js';
import type { TokenUsage } from './usage.js';
export interface AiBudget {
  acquire(actor: string): Promise<() => Promise<void>>;
  reserveTokens?(actor: string, estimate: number): Promise<(actual: number) => Promise<void>>;
}
const defaults = { actor: 350_000, account: 5_000_000 };
const exhausted = () =>
  new AccessError(429, 'Daily AI token budget reached. Try a shorter request or come back later.');

export async function completeWithinBudget(
  budget: AiBudget,
  actor: string,
  provider: Provider,
  messages: Parameters<Provider['complete']>[0],
  tools: Parameters<Provider['complete']>[1],
  signal: AbortSignal,
  options?: Parameters<Provider['complete']>[3] & { onDispatch?: () => void },
) {
  signal.throwIfAborted();
  const { onDispatch, ...generation } = options ?? { maxOutputTokens: 1800 };
  // Meter model input, excluding opaque transport bytes. File tokens vary by provider.
  const estimate =
    Buffer.byteLength(
      JSON.stringify({
        messages: messages.map(({ attachments, providerParts, ...message }) => message),
        tools,
        schema: options?.responseSchema,
      }),
      'utf8',
    ) +
    messages.reduce((total, message) => total + 32_000 * (message.attachments?.length ?? 0), 0) +
    (options?.maxOutputTokens ?? 1800);
  const settle = await budget.reserveTokens?.(actor, estimate);
  let actual: number | undefined;
  let observed = false;
  const observe = (usage: TokenUsage) => {
    const tokens =
      usage.totalTokens ??
      (usage.inputTokens !== null && usage.outputTokens !== null
        ? usage.inputTokens + usage.outputTokens
        : null);
    if (tokens !== null && Number.isSafeInteger(tokens) && tokens >= 0) actual = tokens;
  };
  try {
    if (signal.aborted) {
      actual = 0;
      signal.throwIfAborted();
    }
    onDispatch?.();
    const result = await provider.complete(messages, tools, signal, {
      ...generation,
      onUsage: usage => {
        observed = true;
        observe(usage);
        generation.onUsage?.(usage);
      },
    });
    if (result.usage) {
      observe(result.usage);
      if (!observed) generation.onUsage?.(result.usage);
    }
    return result;
  } finally {
    await settle?.(actual ?? estimate);
  }
}
// Local/test fallback only. Hosted runtime injects SqlAiBudget.
export class MemoryAiBudget implements AiBudget {
  private actors = new Map<
    string,
    { minute: number; count: number; lease?: string; expires: number }
  >();
  private day = -1;
  private count = 0;
  private tokenDay = -1;
  private tokens = { total: 0, actors: new Map<string, number>() };
  constructor(
    private now = Date.now,
    private tokenLimits = defaults,
  ) {}
  async reserveTokens(actor: string, estimate: number) {
    const day = Math.floor(this.now() / 86400000);
    if (day !== this.tokenDay) {
      this.tokenDay = day;
      this.tokens = { total: 0, actors: new Map() };
    }
    const ledger = this.tokens;
    const used = ledger.actors.get(actor) ?? 0;
    if (
      used + estimate > this.tokenLimits.actor ||
      ledger.total + estimate > this.tokenLimits.account
    )
      throw exhausted();
    ledger.total += estimate;
    ledger.actors.set(actor, used + estimate);
    let settled = false;
    return async (actual: number) => {
      if (settled) return;
      settled = true;
      const difference = actual - estimate;
      ledger.total += difference;
      ledger.actors.set(actor, (ledger.actors.get(actor) ?? 0) + difference);
    };
  }
  async acquire(actor: string) {
    const now = this.now(),
      minute = Math.floor(now / 60000),
      day = Math.floor(now / 86400000);
    if (day !== this.day) {
      this.day = day;
      this.count = 0;
    }
    for (const [id, entry] of this.actors)
      if (entry.expires <= now && entry.minute !== minute) this.actors.delete(id);
    const prior = this.actors.get(actor);
    if (prior?.lease && prior.expires > now)
      throw new AccessError(429, 'A reply is already being generated.');
    const count = prior?.minute === minute ? prior.count : 0;
    if (count >= 10 || this.count >= 500)
      throw new AccessError(429, 'AI request limit reached. Please try again later.');
    const lease = randomUUID();
    this.count++;
    this.actors.set(actor, { minute, count: count + 1, lease, expires: now + 120000 });
    return async () => {
      const entry = this.actors.get(actor);
      if (entry?.lease === lease) entry.lease = undefined;
    };
  }
}
export class SqlAiBudget implements AiBudget {
  private tokenLimits: typeof defaults;
  constructor(
    private accountId: string,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    const limit = (key: string, fallback: number) => {
      if (env[key] === undefined) return fallback;
      const value = Number(env[key]);
      if (!Number.isSafeInteger(value) || value < 1 || value > 2_000_000_000)
        throw Error(`Invalid ${key}: expected a positive whole token limit.`);
      return value;
    };
    this.tokenLimits = {
      actor: limit('AI_ACTOR_DAILY_TOKEN_LIMIT', defaults.actor),
      account: limit('AI_ACCOUNT_DAILY_TOKEN_LIMIT', defaults.account),
    };
  }
  async reserveTokens(actor: string, estimate: number) {
    const id = randomUUID();
    const run = (operation: string, tokens: number) =>
      withRuntimeDatabase(pool =>
        pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.accountId)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('reservation_id', sql.UniqueIdentifier, id)
          .input('operation', sql.VarChar(8), operation)
          .input('tokens', sql.BigInt, tokens)
          .input('actor_limit', sql.Int, this.tokenLimits.actor)
          .input('account_limit', sql.Int, this.tokenLimits.account)
          .execute('dbo.AiTokenBudget'),
      );
    try {
      await run('reserve', estimate);
    } catch (error) {
      const number = (error as { number?: number })?.number;
      if (number === 51029) throw exhausted();
      if (number === 51003) throw new AccessError(403, 'Assistant access is not assigned.');
      throw new AccessError(503, 'AI capacity could not be checked. Please retry shortly.');
    }
    return async (actual: number) => {
      try {
        await run('settle', actual);
      } catch (error) {
        // The estimate is already charged. A failed settlement cannot admit a new call for free.
        logEvent('warn', 'ai.budget.settlement_failed', {
          requestId: currentRequestId(),
          errorType: errorType(error),
        });
      }
    };
  }
  async acquire(actor: string) {
    const lease = randomUUID();
    const run = (operation: string) =>
      withRuntimeDatabase(pool =>
        pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.accountId)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('lease_id', sql.UniqueIdentifier, lease)
          .input('operation', sql.VarChar(8), operation)
          .execute('dbo.AiRequestBudget'),
      );
    try {
      await run('acquire');
    } catch (error) {
      const number = (error as { number?: number }).number;
      if (number === 51029)
        throw new AccessError(
          429,
          'AI is busy or your request limit was reached. Please try again shortly.',
        );
      if (number === 51003) throw new AccessError(403, 'Assistant access is not assigned.');
      throw new AccessError(503, 'AI capacity could not be checked. Please retry shortly.');
    }
    return async () => {
      try {
        await run('release');
      } catch (error) {
        logEvent('warn', 'ai.budget.release_failed', {
          requestId: currentRequestId(),
          errorType: errorType(error),
        });
      }
    };
  }
}
