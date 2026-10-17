import test from 'node:test';
import assert from 'node:assert/strict';
import { dateInZone } from '../src/learning-calendar';
import { indexLearningTasks } from '../src/learning-task-index';
import type { Plan } from '../src/Learning';

test('reused timezone formatters follow midnight and daylight saving, and still reject invalid input', () => {
  for (const [instant, zone, expected] of [
    ['2026-10-17T18:29:59Z', 'Asia/Kolkata', '2026-10-17'],
    ['2026-10-17T18:30:00Z', 'Asia/Kolkata', '2026-10-18'],
    ['2026-11-01T03:59:59Z', 'America/New_York', '2026-10-31'],
    ['2026-11-01T04:00:00Z', 'America/New_York', '2026-11-01'],
    ['2026-11-01T05:30:00Z', 'America/New_York', '2026-11-01'],
    ['2026-11-01T06:30:00Z', 'America/New_York', '2026-11-01'],
  ])
    assert.equal(dateInZone(new Date(instant), zone), expected);
  assert.throws(() => dateInZone(new Date(), 'invalid/zone'), RangeError);
  assert.throws(() => dateInZone(new Date(NaN), 'Asia/Kolkata'), RangeError);
  assert.equal(dateInZone(new Date('2026-10-17T00:00:00Z'), 'Asia/Kolkata'), '2026-10-17');
});

test('formatter reuse stays bounded when many different timezones are viewed', () => {
  const native = Intl.DateTimeFormat;
  let constructions = 0;
  Intl.DateTimeFormat = new Proxy(native, {
    construct(target, args) {
      constructions++;
      return Reflect.construct(target, args);
    },
  });
  try {
    const zones = Intl.supportedValuesOf('timeZone').slice(0, 33);
    const at = new Date('2026-10-17T00:00:00Z');
    for (const zone of zones.slice(0, 32)) dateInZone(at, zone);
    const warm = constructions;
    dateInZone(at, zones[31]);
    assert.equal(constructions, warm, 'repeated formatting reuses an Intl object');
    dateInZone(at, zones[32]);
    const filled = constructions;
    dateInZone(at, zones[0]);
    assert.equal(
      constructions,
      filled + 1,
      'old formatters are evicted instead of growing without bound',
    );
  } finally {
    Intl.DateTimeFormat = native;
  }
});

test('indexed learning views preserve completed work, active calendar counts, overdue counts and task ordering', () => {
  const plans: Plan[] = Array.from({ length: 12 }, (_, p) => ({
    id: `p${p}`,
    revision: 1,
    title: `Plan ${p}`,
    goal: 'Learn',
    timezone: p % 2 ? 'America/Los_Angeles' : 'Asia/Kolkata',
    status: (['ACTIVE', 'PAUSED', 'ARCHIVED'] as const)[p % 3],
    dailyMinutes: 30,
    targetDate: '2026-10-31',
    tasks: Array.from({ length: 20 }, (_, t) => ({
      id: `${p}-${t}`,
      title: `Task ${t}`,
      estimatedMinutes: 30,
      plannedDate: `2026-10-${String(10 + t).padStart(2, '0')}`,
      ...(t % 4 === 0 ? { completedAt: '2026-10-17T00:00:00Z' } : {}),
    })),
  }));
  const before = JSON.stringify(plans);
  for (const at of [new Date('2026-10-17T18:29:59Z'), new Date('2026-10-17T18:30:00Z')]) {
    const all = plans.flatMap(plan => plan.tasks.map(task => ({ plan, task })));
    const active = all.filter(({ plan }) => plan.status === 'ACTIVE');
    const index = indexLearningTasks(plans, at);
    const ids = (rows: typeof all) => rows.map(({ task }) => task.id);
    const nativeDay = (zone: string) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(at);
    const overdue = active.filter(
      ({ plan, task }) => !task.completedAt && task.plannedDate < nativeDay(plan.timezone),
    );
    assert.deepEqual(ids(index.backlog), ids(overdue));
    assert.deepEqual(ids(index.completed), ids(all.filter(({ task }) => task.completedAt)));
    assert.deepEqual(
      ids(index.todayTasks()),
      ids(active.filter(({ plan, task }) => task.plannedDate === nativeDay(plan.timezone))),
    );
    for (const plan of plans)
      assert.equal(
        index.overdueByPlan.get(plan.id) ?? 0,
        overdue.filter(row => row.plan.id === plan.id).length,
      );
    for (let day = 1; day <= 31; day++) {
      const date = `2026-10-${String(day).padStart(2, '0')}`;
      assert.deepEqual(
        ids(index.tasksByDay.get(date) ?? []),
        ids(active.filter(({ task }) => task.plannedDate === date)),
      );
    }
  }
  assert.equal(JSON.stringify(plans), before);
  assert.deepEqual(indexLearningTasks([], new Date()).todayTasks(), []);
});
