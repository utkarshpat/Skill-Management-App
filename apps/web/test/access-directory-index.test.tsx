import test from 'node:test';
import assert from 'node:assert/strict';
import {
  indexAccessDirectory,
  type DirectoryPerson,
  type DirectoryRole,
} from '../src/access-directory-index';

test('indexed directory search preserves name/code/template matching, order and exact membership counts', () => {
  const roles: DirectoryRole[] = [
    { id: 'a', name: 'Catalogue Editor', permissions: [] },
    { id: 'b', name: 'Business Analyst', permissions: [] },
    { id: 'c', name: 'Unassigned', permissions: [] },
  ];
  const people: DirectoryPerson[] = [
    {
      id: '1',
      displayName: 'Asha Patel',
      employeeCode: 'E-001',
      active: true,
      roleIds: ['b', 'a', 'a'],
    },
    {
      id: '2',
      displayName: 'Meera',
      employeeCode: 'E-002',
      active: false,
      roleIds: ['b', 'missing'],
    },
    { id: '3', displayName: 'No templates', employeeCode: 'E-003', active: true, roleIds: [] },
  ];
  const before = JSON.stringify({ people, roles });
  const index = indexAccessDirectory(people, roles);
  for (const query of [
    '',
    'asha',
    'e-002',
    'catalogue editor',
    'business',
    'editor business',
    'missing',
    'absent',
  ]) {
    for (const status of ['', 'active', 'suspended']) {
      const expected = people.filter(
        person =>
          (
            person.displayName +
            ' ' +
            person.employeeCode +
            ' ' +
            roles
              .filter(role => person.roleIds.includes(role.id))
              .map(role => role.name)
              .join(' ')
          )
            .toLocaleLowerCase()
            .includes(query) &&
          (!status || (status === 'active') === person.active),
      );
      const actual = index.people
        .filter(
          ({ person, text }) =>
            text.includes(query) && (!status || (status === 'active') === person.active),
        )
        .map(({ person }) => person);
      assert.deepEqual(actual, expected, `${query}/${status}`);
    }
  }
  assert.deepEqual(
    [...index.memberCounts],
    [
      ['a', 1],
      ['b', 2],
      ['c', 0],
    ],
  );
  assert.equal(index.roleNames.get('missing'), undefined);
  assert.equal(
    JSON.stringify({ people, roles }),
    before,
    'indexing does not change authoritative input data',
  );
});

test('a refreshed roster/template list produces fresh search text and counts', () => {
  const person = { id: '1', displayName: 'Asha', employeeCode: 'E1', active: true, roleIds: ['a'] };
  const first = indexAccessDirectory(
    [person],
    [{ id: 'a', name: 'Old template', permissions: [] }],
  );
  const next = indexAccessDirectory(
    [{ ...person, roleIds: [] }],
    [{ id: 'a', name: 'New template', permissions: [] }],
  );
  assert.match(first.people[0].text, /old template/);
  assert.doesNotMatch(next.people[0].text, /old template|new template/);
  assert.equal(next.memberCounts.get('a'), 0);
  assert.equal(next.roles[0].text, 'new template');
  assert.deepEqual(indexAccessDirectory([], []).people, []);
});
