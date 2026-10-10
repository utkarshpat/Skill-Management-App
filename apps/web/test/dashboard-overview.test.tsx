import test from 'node:test';
import assert from 'node:assert/strict';
import { readDashboardOverview } from '../src/dashboard-overview';

const fixture = () => ({
  actorId: 'actor',
  revision: 1,
  ai: false,
  actions: [],
  cards: [
    {
      id: 'learning',
      title: 'Learning',
      description: 'Today',
      endpoint: '/api/dashboard/learning',
      priority: 1,
      size: 'medium',
      scope: { kind: 'OWN', actorId: 'actor' },
    },
  ],
  cardData: { learning: { data: { total: 3, completed: 1 } } },
});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
test('overview reads ready card snapshots and independent retryable failures in one response', async () => {
  const valid = fixture();
  assert.deepEqual(await readDashboardOverview(response(valid)), valid);
  const failed = {
    ...valid,
    cardData: { learning: { error: { status: 503, message: 'Try again' } } },
  };
  assert.deepEqual(await readDashboardOverview(response(failed)), failed);
  await assert.rejects(
    readDashboardOverview(response({ error: { message: 'Access changed' } }, 403)),
    (error: any) => error.status === 403 && error.message === 'Access changed',
  );
});
test('missing, foreign, duplicate and malformed card snapshots fail before rendering', async () => {
  const valid = fixture();
  const malformed = [
    {},
    { ...valid, cardData: {} },
    { ...valid, cards: [valid.cards[0], valid.cards[0]] },
    { ...valid, cards: [{ ...valid.cards[0], scope: { kind: 'OWN', actorId: 'someone-else' } }] },
    { ...valid, cards: [{ ...valid.cards[0], endpoint: '/api/access' }] },
    { ...valid, cardData: { ...valid.cardData, capability: { data: { total: 99 } } } },
    { ...valid, cardData: { learning: { data: { total: -1 } } } },
    {
      ...valid,
      cardData: { learning: { data: { total: 1 }, error: { status: 503, message: 'ambiguous' } } },
    },
    ...[401, 403, 409].map(status => ({
      ...valid,
      cardData: { learning: { error: { status, message: 'Denied' } } },
    })),
  ];
  for (const body of malformed)
    await assert.rejects(readDashboardOverview(response(body)), /incomplete/);
  await assert.rejects(readDashboardOverview(new Response('broken-json')), /incomplete/);
});
