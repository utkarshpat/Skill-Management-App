import test from 'node:test';
import assert from 'node:assert/strict';
import { ancestorSelected, selectAudienceScope } from '../src/announcement-audience';

const scopes = [
  { id: 'du', kind: 'DELIVERY_UNIT', label: 'Unit', grantId: 'g' },
  {
    id: 'pf',
    kind: 'PORTFOLIO',
    label: 'Portfolio',
    grantId: 'g',
    parentId: 'du',
    parentKind: 'DELIVERY_UNIT',
  },
  {
    id: 'ac',
    kind: 'DEPARTMENT',
    label: 'Client',
    grantId: 'g',
    parentId: 'pf',
    parentKind: 'PORTFOLIO',
  },
  {
    id: 'pr',
    kind: 'PROJECT',
    label: 'Project',
    grantId: 'g',
    parentId: 'ac',
    parentKind: 'DEPARTMENT',
  },
];
test('parent selection includes authorized descendants and stores a minimal audience without implied exclusions', () => {
  const selected = selectAudienceScope(scopes[0], [scopes[3]], scopes, true);
  assert.deepEqual(selected, [{ id: 'du', kind: 'DELIVERY_UNIT' }]);
  assert.equal(ancestorSelected(scopes[3], selected, scopes), true);
  assert.equal(ancestorSelected(scopes[0], selected, scopes), false);
  assert.deepEqual(selectAudienceScope(scopes[0], selected, scopes, false), []);
  assert.equal(ancestorSelected(scopes[3], [{ id: 'other', kind: 'PORTFOLIO' }], scopes), false);
});
