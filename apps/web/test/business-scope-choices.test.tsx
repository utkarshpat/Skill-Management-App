import test from 'node:test';
import assert from 'node:assert/strict';
import {
  businessScopeChoices,
  businessScopeLabel,
  type BusinessScope,
} from '../src/business/business-model';
test('scope choices deduplicate bindings by scope identity while retaining selected server IDs', () => {
  const scopes: BusinessScope[] = [
    {
      id: 'admin',
      kind: 'ORGANIZATION',
      scopeId: null,
      label: 'Organization',
      effect: 'ALLOW',
      bundle: 'SYSTEM_ADMIN',
    },
    {
      id: 'analytics',
      kind: 'ORGANIZATION',
      scopeId: null,
      label: 'Organization',
      effect: 'ALLOW',
      bundle: 'BUSINESS_OPERATIONS',
    },
    {
      id: 'uk-a',
      kind: 'DELIVERY_UNIT',
      scopeId: 'a',
      label: 'UK',
      effect: 'ALLOW',
      bundle: 'BUSINESS_OPERATIONS',
    },
    {
      id: 'uk-b',
      kind: 'DELIVERY_UNIT',
      scopeId: 'b',
      label: 'UK',
      effect: 'ALLOW',
      bundle: 'BUSINESS_OPERATIONS',
    },
    {
      id: 'deny',
      kind: 'ORGANIZATION',
      scopeId: null,
      label: 'Organization',
      effect: 'DENY',
      bundle: 'BUSINESS_OPERATIONS',
    },
  ];
  const before = JSON.stringify(scopes);
  assert.deepEqual(
    businessScopeChoices(scopes).map(s => s.id),
    ['admin', 'uk-a', 'uk-b'],
  );
  assert.deepEqual(
    businessScopeChoices(scopes, 'analytics').map(s => s.id),
    ['analytics', 'uk-a', 'uk-b'],
  );
  assert.equal(JSON.stringify(scopes), before);
  assert.equal(businessScopeLabel(scopes[0]), 'Organization');
  assert.equal(businessScopeLabel(scopes[2]), 'DELIVERY UNIT · UK');
});
