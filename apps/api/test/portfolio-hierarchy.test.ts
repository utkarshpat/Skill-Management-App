import test from 'node:test';
import assert from 'node:assert/strict';
import {
  organizationChange,
  organizationPath,
  reportingChain,
  type NodeKind,
  type OrganizationState,
} from '../src/modules/organization/organization.js';
import { previewOrganization } from '../src/modules/organization/preview.js';
import { businessChange, previewBusiness } from '../src/modules/business/business.js';

const ids = Array.from(
  { length: 10 },
  (_, i) => `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
);
const [unit, portfolio, client, project, employee, actor] = ids;
const kinds: NodeKind[] = ['DELIVERY_UNIT', 'PORTFOLIO', 'DEPARTMENT', 'TEAM'];
function state(): OrganizationState {
  return {
    revision: 7,
    nodes: kinds.map((kind, i) => ({
      id: ids[i],
      kind,
      name: kind,
      parentId: i ? ids[i - 1] : null,
      active: true,
    })),
    people: [{ id: employee, displayName: 'Employee', employeeCode: 'TEST', active: true }],
    assignments: [],
  };
}
for (const [index, kind] of kinds.entries()) {
  for (const parent of [null, ...ids.slice(0, 4)]) {
    test(`${kind} accepts only its exact preceding active level: parent ${parent ?? 'root'}`, () => {
      const input = {
        revision: 7,
        kind: 'node',
        type: kind,
        name: 'New node',
        parentId: parent,
        active: true,
      };
      if (parent === (index ? ids[index - 1] : null))
        assert.ok(previewOrganization(state(), actor, input).receipt);
      else assert.throws(() => previewOrganization(state(), actor, input));
    });
  }
}
test('complete paths support direct client and organizational project placements without changing IDs', () => {
  const source = state();
  for (const [id, key] of [
    [client, 'departmentId'],
    [project, 'teamId'],
  ] as const) {
    assert.deepEqual(
      organizationPath(source, id)?.map(n => n.kind),
      kinds.slice(0, key === 'teamId' ? 4 : 3).reverse(),
    );
    const result = previewOrganization(source, actor, {
      revision: 7,
      kind: 'assignment',
      personId: employee,
      [key]: id,
    });
    assert.equal((result.after as Record<string, unknown>)[key], id);
    assert.match(result.warnings.join(' '), /not automatically grant/);
  }
});
for (const index of [0, 1, 2, 3]) {
  test(`inactive ancestor ${kinds[index]} fails closed for project placement`, () => {
    const source = state();
    source.nodes[index].active = false;
    assert.equal(organizationPath(source, project), undefined);
    assert.throws(() =>
      previewOrganization(source, actor, {
        revision: 7,
        kind: 'assignment',
        personId: employee,
        teamId: project,
      }),
    );
  });
}
test('legacy, missing, duplicate, cyclic and wrongly typed ancestry never resolves', () => {
  const changes = [
    (s: OrganizationState) => {
      s.nodes[2].parentId = unit;
    },
    (s: OrganizationState) => {
      s.nodes[1].parentId = null;
    },
    (s: OrganizationState) => {
      s.nodes[0].parentId = project;
    },
    (s: OrganizationState) => {
      s.nodes[1].parentId = client;
    },
    (s: OrganizationState) => {
      s.nodes.splice(1, 1);
    },
    (s: OrganizationState) => {
      s.nodes.push({ ...s.nodes[1] });
    },
    (s: OrganizationState) => {
      s.nodes[1].kind = 'TEAM';
    },
  ];
  for (const change of changes) {
    const source = state();
    change(source);
    assert.equal(organizationPath(source, project), undefined);
    assert.throws(() =>
      previewOrganization(source, actor, {
        revision: 7,
        kind: 'assignment',
        personId: employee,
        departmentId: client,
      }),
    );
  }
});
test('DU and Portfolio are not employee placement kinds; Portfolio business responsibilities are explicit', () => {
  for (const id of [unit, portfolio]) {
    for (const key of ['departmentId', 'teamId'])
      assert.throws(() =>
        previewOrganization(state(), actor, {
          revision: 7,
          kind: 'assignment',
          personId: employee,
          [key]: id,
        }),
      );
  }
  assert.ok(
    businessChange({
      revision: 7,
      kind: 'RESPONSIBILITY',
      id: actor,
      payload: {
        personId: employee,
        kind: 'PORTFOLIO',
        scopeId: portfolio,
        bundle: 'BUSINESS_OPERATIONS',
        effect: 'ALLOW',
        active: true,
        reason: 'Explicit reviewed Portfolio analytics scope',
      },
    }),
  );
  for (const type of ['PROJECT', '__proto__', 'constructor', 'DIVISION'])
    assert.throws(() =>
      organizationChange({
        revision: 7,
        kind: 'node',
        type,
        name: 'Wrong',
        parentId: unit,
        active: true,
      }),
    );
});
test('existing levels cannot change type; cross-workspace/missing parents and stale previews are rejected', () => {
  const source = state();
  for (const input of [
    { id: client, type: 'PORTFOLIO', parentId: unit },
    { id: ids[9], type: 'DEPARTMENT', parentId: portfolio },
    { type: 'DEPARTMENT', parentId: ids[9] },
    { type: 'DEPARTMENT', parentId: portfolio, revision: 6 },
  ])
    assert.throws(() =>
      previewOrganization(source, actor, {
        revision: 7,
        kind: 'node',
        name: 'Client',
        active: true,
        ...input,
      }),
    );
});
test('preview is nonmutating and binds actor, exact command and current hierarchy to the receipt', () => {
  const source = state(),
    original = structuredClone(source);
  const input = {
    revision: 7,
    kind: 'node',
    id: client,
    type: 'DEPARTMENT',
    name: 'Client',
    parentId: portfolio,
    active: true,
  };
  const first = previewOrganization(source, actor, input);
  assert.deepEqual(source, original);
  assert.equal(first.receipt, previewOrganization(source, actor, input).receipt);
  assert.notEqual(first.receipt, previewOrganization(source, employee, input).receipt);
  assert.notEqual(
    first.receipt,
    previewOrganization(source, actor, { ...input, name: 'Changed' }).receipt,
  );
  source.nodes[1].name = 'Changed division';
  assert.notEqual(first.receipt, previewOrganization(source, actor, input).receipt);
  assert.match(first.warnings.join(' '), /Delivery Unit-scoped.*DENY/);
});
test('archiving a portfolio with active clients or a placement with assigned people is rejected before confirmation', () => {
  const source = state();
  const input = {
    revision: 7,
    kind: 'node',
    id: portfolio,
    type: 'PORTFOLIO',
    name: 'Division',
    parentId: unit,
    active: false,
  };
  assert.throws(() => previewOrganization(source, actor, input), /archive active children/);
  source.nodes[2].active = false;
  assert.ok(previewOrganization(source, actor, input).receipt);
  source.assignments = [{ personId: employee, teamId: project, managerId: null }];
  assert.throws(
    () =>
      previewOrganization(source, actor, {
        ...input,
        id: project,
        type: 'TEAM',
        parentId: client,
      }),
    /Move assigned people/,
  );
});
test('five-level reporting remains person-to-person, not organization/title-derived', () => {
  const source = state();
  source.people = ids
    .slice(4)
    .map((id, i) => ({ id, displayName: `Person ${i}`, employeeCode: `P${i}`, active: true }));
  source.assignments = source.people.map((person, i) => ({
    personId: person.id,
    managerId: source.people[i + 1]?.id ?? null,
    teamId: null,
  }));
  assert.deepEqual(
    reportingChain(source, employee).map(p => p.id),
    ids.slice(5),
  );
  source.assignments.at(-1)!.managerId = employee;
  assert.throws(() => reportingChain(source, employee));
  source.assignments.at(-1)!.managerId = null;
  source.people[3].active = false;
  assert.throws(() => reportingChain(source, employee));
});
test('Business previews trust canonical scope validity, never a node label or caller flag', () => {
  const input = {
    revision: 7,
    kind: 'RESPONSIBILITY',
    id: ids[9],
    payload: {
      personId: employee,
      kind: 'DEPARTMENT',
      scopeId: client,
      bundle: 'BUSINESS_OPERATIONS',
      effect: 'ALLOW',
      active: true,
      reason: 'Reviewed scope',
    },
  };
  const current = {
    revision: 7,
    people: [{ id: employee, name: 'Employee', active: true }],
    nodes: [{ id: client, name: 'Client', kind: 'DEPARTMENT', active: true, scopeValid: true }],
    projects: [],
    responsibilities: [],
  };
  assert.ok(previewBusiness(actor, current, businessChange(input)).receipt);
  for (const scopeValid of [false, undefined])
    assert.throws(() =>
      previewBusiness(
        actor,
        {
          ...current,
          nodes: [{ ...current.nodes[0], scopeValid }],
        },
        businessChange({ ...input, payload: { ...input.payload, scopeValid: true } }),
      ),
    );
  assert.ok(
    previewBusiness(
      actor,
      {
        ...current,
        nodes: [{ ...current.nodes[0], scopeValid: false }],
      },
      businessChange({ ...input, payload: { ...input.payload, active: false } }),
    ).receipt,
  );
});
test('Business project bindings require full client ancestry while preserving explicit deactivation', () => {
  const current = {
    revision: 7,
    projects: [],
    nodes: [{ id: client, name: 'Client', kind: 'DEPARTMENT', active: true, scopeValid: true }],
  };
  const input = {
    revision: 7,
    kind: 'PROJECT',
    id: ids[9],
    payload: {
      name: 'Business project',
      departmentId: client,
      active: true,
      reason: 'Reviewed binding',
    },
  };
  assert.ok(previewBusiness(actor, current, businessChange(input)).receipt);
  const unmapped = { ...current, nodes: [{ ...current.nodes[0], scopeValid: false }] };
  assert.throws(
    () => previewBusiness(actor, unmapped, businessChange(input)),
    /Portfolio\/Division/,
  );
  assert.ok(
    previewBusiness(
      actor,
      unmapped,
      businessChange({
        ...input,
        payload: { ...input.payload, active: false },
      }),
    ).receipt,
  );
  for (const nodes of [
    [],
    [{ ...current.nodes[0], kind: 'PORTFOLIO' }],
    [{ ...current.nodes[0], active: false }],
  ])
    assert.throws(() => previewBusiness(actor, { ...current, nodes }, businessChange(input)));
});
