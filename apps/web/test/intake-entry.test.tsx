import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveIntakeSkill } from '../src/capabilities/intake-entry';

test('learning canonical ID resolves a renamed skill across catalogue pages without searching a UUID', async () => {
  const paths: string[] = [];
  const choice = {
    id: 'canonical-id',
    name: 'Renamed skill',
    category: 'Data',
    definitionRevision: 2,
    levels: [],
  };
  const found = await resolveIntakeSkill({ id: choice.id, name: 'Old name' }, async path => {
    paths.push(path);
    const q = new URL(path, 'http://local').searchParams;
    const page = Number(q.get('page'));
    return {
      skills: q.get('search') ? [] : page === 2 ? [choice] : [{ ...choice, id: 'unrelated-id' }],
      total: q.get('search') ? 0 : 26,
      page,
      pageSize: 25,
    };
  });
  assert.equal(found, choice);
  assert.equal(paths.length, 3);
  assert.ok(paths.every(path => !path.includes('canonical-id')));
});

test('intake never substitutes another skill with the same name for a missing canonical ID', async () => {
  const choice = {
    id: 'other',
    name: 'Same name',
    category: 'Data',
    definitionRevision: 1,
    levels: [],
  };
  assert.equal(
    await resolveIntakeSkill({ id: 'missing', name: choice.name }, async () => ({
      skills: [choice],
      total: 1,
      page: 1,
      pageSize: 25,
    })),
    undefined,
  );
  assert.equal(
    await resolveIntakeSkill({ name: 'same name' }, async () => ({
      skills: [choice],
      total: 1,
      page: 1,
      pageSize: 25,
    })),
    choice,
  );
});
