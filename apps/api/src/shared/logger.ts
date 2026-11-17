type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

const priorities: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const configured = process.env.APP_LOG_LEVEL?.toLowerCase();
const threshold =
  configured === 'silent'
    ? Infinity
    : configured && configured in priorities
      ? priorities[configured as Level]
      : priorities.info;
const privateField =
  /authorization|cookie|secret|password|token|email|upn|tenant|object.?id|employee|person|actor|prompt|body|payload|query|credential|client.?id|login.?hint|logout.?hint/i;
const reservedField = /^(timestamp|level|service|event)$/i;
const tokenCount = /^(inputTokens|outputTokens|thinkingTokens|cachedInputTokens|totalTokens)$/;

function clean(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240);
  if (Array.isArray(value))
    return depth >= 3 ? undefined : value.slice(0, 20).map(v => clean(v, depth + 1));
  if (typeof value === 'object' && depth < 3) {
    const result: Fields = {};
    for (const [key, child] of Object.entries(value)) {
      if (tokenCount.test(key) && typeof child === 'number' && Number.isFinite(child)) {
        result[key] = child;
        continue;
      }
      if (privateField.test(key) || reservedField.test(key)) continue;
      const safe = clean(child, depth + 1);
      if (safe !== undefined) result[key] = safe;
    }
    return result;
  }
  return undefined;
}

export function logEvent(level: Level, event: string, fields: Fields = {}) {
  if (priorities[level] < threshold) return;
  const safeFields = clean(fields) as Fields | undefined;
  const record = {
    timestamp: new Date().toISOString(),
    level,
    service: 'skill-management-api',
    event: event.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80),
    ...(safeFields ?? {}),
  };
  const line = JSON.stringify(record);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

export function errorType(error: unknown) {
  return error instanceof Error ? error.constructor.name.slice(0, 100) : 'UnknownError';
}
