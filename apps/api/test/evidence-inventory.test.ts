import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evidenceInventory,
  historicalEvidenceReferences,
} from '../src/modules/skills/evidence-inventory.js';
const account = '11111111-1111-1111-1111-111111111111';
test('inventory retains history, unreferenced objects and incomplete scans without crossing accounts', () => {
  const prefix = account + '/';
  const history = historicalEvidenceReferences(
    [JSON.stringify({ items: [{ files: [{ blobName: prefix + 'old.pdf' }] }] })],
    prefix,
  );
  assert.equal(history.complete, true);
  const objects = [
    { name: prefix + 'old.pdf', bytes: 10 },
    { name: prefix + 'unused.pdf', bytes: 20 },
    { name: 'other-account/private.pdf', bytes: 30 },
  ];
  const report = evidenceInventory(account, objects, history.references, true);
  assert.equal(report.deletionEnabled, false);
  assert.equal(report.deletedObjects, 0);
  assert.equal(report.objects.length, 2);
  assert.equal(report.objects[0].status, 'Referenced; retain');
  assert.equal(report.objects[1].status, 'Unreferenced at scan; retain pending policy');
  assert.equal(
    evidenceInventory(account, objects, history.references, false).objects[1].status,
    'Reference scan incomplete; retain',
  );
});
test('unreadable or foreign historical references invalidate the scan', () => {
  assert.equal(historicalEvidenceReferences(['{broken'], account + '/').complete, false);
  assert.equal(
    historicalEvidenceReferences(['{"blob_name":"foreign/file.pdf"}'], account + '/').complete,
    false,
  );
  assert.throws(() => evidenceInventory('invalid', [], new Set(), true));
});
