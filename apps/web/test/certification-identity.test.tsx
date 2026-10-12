import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sameCertificate,
  submissionPayload,
  type SelectedCertificate,
} from '../src/capabilities/capability-model';
const fields = {
  certificationName: 'Azure Developer',
  provider: 'Microsoft',
  credentialId: 'CERT-101',
  category: 'Cloud',
  certificationDate: '2026-01-01',
  expiryDate: '2027-01-01',
  credentialUrl: '',
  notes: '',
};
const certificate = (
  id: string,
  extra: Partial<SelectedCertificate> = {},
): SelectedCertificate => ({
  id,
  revision: 0,
  reuse: false,
  fields,
  skillIds: ['skill'],
  uploaded: false,
  ...extra,
});
test('semantic identity catches case/spacing, printed ID aliases and absent-ID duplicates without cross-issuer false positives', () => {
  assert.equal(
    sameCertificate(fields, {
      ...fields,
      certificationName: ' azure  developer ',
      provider: ' MICROSOFT ',
    }),
    true,
  );
  assert.equal(
    sameCertificate(fields, {
      ...fields,
      certificationName: 'Different name',
      credentialId: ' cert-101 ',
    }),
    true,
  );
  assert.equal(
    sameCertificate({ ...fields, credentialId: '' }, { ...fields, credentialId: '' }),
    true,
  );
  assert.equal(sameCertificate(fields, { ...fields, provider: 'Another issuer' }), false);
  assert.equal(
    sameCertificate(
      { ...fields, credentialId: '' },
      { ...fields, certificationName: 'Different name', credentialId: '' },
    ),
    false,
  );
});
test('new records cannot bypass own-existing or same-form identity checks by picking different UUIDs; reuse and renewal remain explicit', () => {
  assert.throws(
    () => submissionPayload('group', 0, [], [certificate('a'), certificate('b')]),
    /already exists/,
  );
  assert.throws(
    () => submissionPayload('group', 0, [], [certificate('a')], [{ id: 'b', ...fields }]),
    /Link the existing/,
  );
  assert.doesNotThrow(() =>
    submissionPayload('group', 0, [], [certificate('a')], [{ id: 'A', ...fields }]),
  );
  assert.doesNotThrow(() =>
    submissionPayload(
      'group',
      0,
      [],
      [certificate('renew', { renewedFromId: 'old' })],
      [{ id: 'old', ...fields }],
    ),
  );
  assert.doesNotThrow(() =>
    submissionPayload(
      'group',
      0,
      [],
      [certificate('a', { reuse: true })],
      [{ id: 'a', ...fields }],
    ),
  );
});
