// Synthetic roster benchmark; this does not measure browser or hosted latency.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { indexAccessDirectory } from '../src/access-directory-index';

const roles = Array.from({ length: 500 }, (_, n) => ({
  id: `r${n}`,
  name: `Template ${n}`,
  permissions: [],
}));
const people = Array.from({ length: 5_000 }, (_, n) => ({
  id: `p${n}`,
  displayName: `Person ${n}`,
  employeeCode: `E${n}`,
  active: n % 7 !== 0,
  roleIds: [n % 500, (n + 3) % 500, (n + 11) % 500].map(n => `r${n}`),
}));
const queries = ['', 'person 2', 'e123', 'template 2', 'template 499', 'missing', 'person', 'e4'];
function measure<T>(run: () => T) {
  const start = performance.now();
  const value = run();
  return { value, ms: Math.round((performance.now() - start) * 100) / 100 };
}
const baseline = measure(() =>
  queries.map(query =>
    people
      .filter(person =>
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
          .includes(query),
      )
      .map(person => person.id),
  ),
);
const build = measure(() => indexAccessDirectory(people, roles));
const search = measure(() =>
  queries.map(query =>
    build.value.people.filter(({ text }) => text.includes(query)).map(({ person }) => person.id),
  ),
);
assert.deepEqual(search.value, baseline.value);
console.log(
  JSON.stringify(
    {
      people: people.length,
      roles: roles.length,
      queries: queries.length,
      baselineSearchMs: baseline.ms,
      indexBuildMs: build.ms,
      indexedSearchMs: search.ms,
      indexedBuildAndSearchMs: Math.round((build.ms + search.ms) * 100) / 100,
      identicalResults: true,
    },
    null,
    2,
  ),
);
