import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  certificationFieldError,
  credentialValidity,
  certificationStatusLabels,
} from '../src/certifications/certification-model';
import { notificationDestination } from '../src/notification-model';

const fields = {
  certificationName: 'Azure Fundamentals',
  provider: 'Microsoft',
  category: 'Cloud',
  certificationDate: '2026-01-01',
  expiryDate: '2026-09-01',
  credentialId: '',
  credentialUrl: 'https://issuer.example/badge',
  notes: '',
};
test('credential expiry remains independent of approval and includes the complete expiry day', () => {
  assert.equal(credentialValidity('2026-10-08', '2026-10-09'), 'Expired');
  assert.equal(credentialValidity('2026-10-09', '2026-10-09'), 'Expires soon');
  assert.equal(credentialValidity('2027-10-09', '2026-10-09'), 'Current');
  assert.equal(credentialValidity(null, '2026-10-09'), 'No expiry');
  assert.equal(certificationStatusLabels.APPROVED, 'Manager reviewed');
});
test('credential form validates dates, required issuer fields and safe links before advancing', () => {
  assert.equal(certificationFieldError(fields, '2026-10-09'), '');
  for (const patch of [
    { provider: '' },
    { certificationDate: '2026-02-30' },
    { certificationDate: '2027-01-01' },
    { expiryDate: '2025-12-31' },
    { expiryDate: '' },
    { credentialUrl: 'javascript:alert(1)' },
    { credentialUrl: 'https://user:password@issuer.example/' },
  ])
    assert.ok(certificationFieldError({ ...fields, ...patch }, '2026-10-09'));
  assert.equal(notificationDestination('/certifications?tab=queue')?.kind, 'Certifications');
});
