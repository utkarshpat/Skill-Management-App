import type { DashboardQuickAction } from './DashboardQuickActions';

export type DashboardCardId = 'attention' | 'learning' | 'capability' | 'requests';
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
  const fail = () => {
    throw Error('Dashboard response is incomplete. Refresh to retry.');
  };
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
