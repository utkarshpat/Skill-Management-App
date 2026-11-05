import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capabilityIntake } from '../src/modules/skills/capability-submissions.js';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  claim = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  skill = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  cert = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const draft = () => ({
  id,
  revision: 0,
  skills: [
    {
      id: claim,
      revision: 0,
      reuse: false,
      choice: {
        id: skill,
        name: 'SQL',
        category: 'Databases',
        definitionRevision: 2,
        levels: [{ rank: 1, name: 'Foundation', description: 'Guided customer reporting queries' }],
      },
      rank: 0,
      experienceMonths: 0,
      description: '',
      projects: 'Customer Insights Modernisation',
      evidence: '',
      lastUsedOn: '',
    },
  ],
  certifications: [
    {
      id: cert,
      revision: 0,
      reuse: false,
      fields: {
        certificationName: 'Oracle SQL',
        provider: 'Oracle',
        category: 'Databases',
        certificationDate: '',
        expiryDate: null,
        credentialId: '',
        credentialUrl: '',
        notes: '',
      },
      skillIds: [skill],
      renewedFromId: claim,
    },
  ],
});
test('incomplete intake preserves editable human data without turning partial fields into submitted claims', () => {
  const value = draft();
  const normalized = capabilityIntake(value);
  assert.deepEqual(normalized, value);
  assert.equal(normalized.skills[0].rank, 0);
  const upper = draft();
  upper.id = id.toUpperCase();
  upper.skills[0].id = claim.toUpperCase();
  upper.skills[0].choice.id = skill.toUpperCase();
  upper.certifications[0].fields.expiryDate = '' as never;
  upper.skills[0].reuse = true;
  upper.certifications[0].reuse = true;
  const result = capabilityIntake(upper);
  assert.equal(result.id, id);
  assert.equal(result.skills[0].id, claim);
  assert.equal(result.skills[0].reuse, true);
  assert.equal(result.certifications[0].fields.expiryDate, '');
  const onlySkills = draft();
  onlySkills.certifications = [];
  assert.equal(capabilityIntake(onlySkills).certifications.length, 0);
  const onlyCertificate = draft();
  onlyCertificate.skills = [];
  assert.equal(capabilityIntake(onlyCertificate).skills.length, 0);
});
test('intake schema rejects malformed containers, injected fields, oversized arrays, invalid numbers and duplicate IDs', () => {
  for (const input of [
    null,
    [],
    true,
    'draft',
    {},
    { id, revision: 0, skills: [], certifications: [] },
  ])
    assert.throws(() => capabilityIntake(input), { status: 400 });
  const changes: ((b: any) => void)[] = [
    b => (b.actorId = cert),
    b => (b.id = 'bad'),
    b => (b.revision = -1),
    b => (b.revision = 2147483647),
    b => (b.skills = 'bad'),
    b => (b.certifications = 'bad'),
    b => (b.skills = Array(11).fill(b.skills[0])),
    b => (b.certifications = Array(11).fill(b.certifications[0])),
    b => (b.skills[0] = null),
    b => (b.skills[0].actorId = cert),
    b => (b.skills[0].choice = null),
    b => (b.skills[0].choice.active = true),
    b => (b.skills[0].choice.levels = {}),
    b => (b.skills[0].choice.levels = Array(9).fill(b.skills[0].choice.levels[0])),
    b => (b.skills[0].choice.levels = [null]),
    b => (b.skills[0].choice.levels[0].authority = 'verified'),
    b => (b.skills[0].choice.levels[0].rank = 9),
    b => (b.skills[0].choice.levels[0].name = 'x'.repeat(61)),
    b => (b.skills[0].choice.levels[0].description = 'x'.repeat(1001)),
    b => (b.skills[0].rank = -1),
    b => (b.skills[0].rank = 9),
    b => (b.skills[0].experienceMonths = 601),
    b => (b.skills[0].experienceMonths = 1.5),
    b => (b.skills[0].choice.definitionRevision = Number.MAX_SAFE_INTEGER),
    b => (b.skills[0].description = 'x'.repeat(2001)),
    b => (b.skills[0].description = null),
    b => (b.skills[0].lastUsedOn = '2026-11-050'),
    b => (b.certifications[0] = null),
    b => (b.certifications[0].status = 'APPROVED'),
    b => (b.certifications[0].fields = null),
    b => (b.certifications[0].fields.approved = true),
    b => (b.certifications[0].fields.provider = 'x'.repeat(121)),
    b => (b.certifications[0].fields.expiryDate = 'x'.repeat(11)),
    b => (b.certifications[0].skillIds = {}),
    b => (b.certifications[0].skillIds = Array(11).fill(skill)),
    b => (b.certifications[0].skillIds = ['invalid']),
    b => (b.certifications[0].renewedFromId = 'invalid'),
    b => b.skills.push({ ...b.skills[0] }),
    b => b.skills.push({ ...b.skills[0], id: cert }),
    b => b.certifications.push({ ...b.certifications[0] }),
    b => (b.certifications[0].id = claim),
  ];
  for (const [index, change] of changes.entries()) {
    const body = draft();
    change(body);
    assert.throws(
      () => capabilityIntake(body),
      { status: 400 },
      'Invalid intake mutation ' + index,
    );
  }
});
