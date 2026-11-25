import type { DashboardQuickAction } from './DashboardQuickActions';

type DashboardCardId = 'attention' | 'learning' | 'capability' | 'requests';
export interface DashboardCardDefinition {
  id: DashboardCardId;
  title: string;
  description: string;
  endpoint: string;
  priority: number;
  size: string;
  scope: { kind: string; actorId: string };
}
export interface DashboardCardResult<T> {
  data?: T;
  error?: { message: string; status: number };
}
export interface DashboardOverview<T> {
  revision: number;
  actorId: string;
  cards: DashboardCardDefinition[];
  actions: DashboardQuickAction[];
  ai: boolean;
  cardData: Partial<Record<DashboardCardId, DashboardCardResult<T>>>;
}
const object = (value: unknown): value is Record<string, any> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export async function readDashboardOverview<T extends { total: number }>(
  response: Response,
): Promise<DashboardOverview<T>> {
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok)
    throw Object.assign(
      Error(
        object(body)
          ? (body.error?.message ?? 'Dashboard could not be loaded.')
          : 'Dashboard could not be loaded.',
      ),
      { status: response.status },
    );
  return parseOverview<T>(body);
}

const fail = (): never => {
  throw Error('Dashboard response is incomplete. Refresh to retry.');
};

function parseOverview<T extends { total: number }>(
  body: unknown,
  partial = false,
): DashboardOverview<T> {
  if (
    !object(body) ||
    !Number.isSafeInteger(body.revision) ||
    body.revision < 0 ||
    typeof body.actorId !== 'string' ||
    !body.actorId ||
    typeof body.ai !== 'boolean' ||
    !Array.isArray(body.actions) ||
    !Array.isArray(body.cards) ||
    !object(body.cardData)
  )
    return fail();
  const ids = new Set<string>();
  for (const card of body.cards) {
    if (
      !object(card) ||
      !['attention', 'learning', 'capability', 'requests'].includes(card.id) ||
      ids.has(card.id) ||
      card.endpoint !== '/api/dashboard/' + card.id ||
      typeof card.title !== 'string' ||
      typeof card.description !== 'string' ||
      !object(card.scope) ||
      card.scope.actorId !== body.actorId ||
      card.scope.kind !== (card.id === 'attention' ? 'ASSIGNED_OR_OWN' : 'OWN')
    )
      return fail();
    ids.add(card.id);
    const result = body.cardData[card.id];
    if (result === undefined && partial) continue;
    if (!object(result) || object(result.data) === object(result.error)) return fail();
    if (result.data && (!Number.isSafeInteger(result.data.total) || result.data.total < 0))
      return fail();
    if (
      result.error &&
      (!Number.isInteger(result.error.status) ||
        result.error.status < 400 ||
        result.error.status > 599 ||
        [401, 403, 409].includes(result.error.status) ||
        typeof result.error.message !== 'string' ||
        !result.error.message)
    )
      return fail();
  }
  if (Object.keys(body.cardData).some(id => !ids.has(id))) return fail();
  return body as unknown as DashboardOverview<T>;
}

export async function readProgressiveDashboard<T extends { total: number }>(
  response: Response,
  publish: (overview: DashboardOverview<T>) => void,
) {
  if (!response.ok || !response.headers.get('Content-Type')?.startsWith('application/x-ndjson')) {
    publish(await readDashboardOverview<T>(response));
    return;
  }
  if (!response.body) return fail();
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let manifest: DashboardOverview<T> | undefined;
  let buffered = '';
  let complete = false;
  try {
    while (!complete) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffered += chunk.value;
      const lines = buffered.split('\n');
      buffered = lines.pop()!;
      for (const line of lines) {
        const event: unknown = JSON.parse(line);
        if (!object(event) || complete) return fail();
        if (event.error)
          throw Object.assign(Error(event.error.message), { status: event.error.status });
        if (!manifest) {
          manifest = parseOverview<T>(event.manifest, true);
          publish(manifest);
        } else if (event.complete === true) {
          parseOverview<T>(manifest);
          complete = true;
        } else {
          const card = manifest.cards.find(card => card.id === event.card);
          if (!card || manifest.cardData[card.id]) return fail();
          manifest = parseOverview<T>(
            {
              ...manifest,
              cardData: { ...manifest.cardData, [card.id]: event.result },
            },
            true,
          );
          publish(manifest);
        }
      }
    }
    if (!complete) return fail();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
